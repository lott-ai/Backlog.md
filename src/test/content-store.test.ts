import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { ContentStore, type ContentStoreEvent } from "../core/content-store.ts";
import { FileSystem } from "../file-system/operations.ts";
import type { Decision, Document, Task } from "../types/index.ts";
import { createUniqueTestDir, getPlatformTimeout, safeCleanup, sleep } from "./test-utils.ts";

let TEST_DIR: string;

describe("ContentStore", () => {
	let filesystem: FileSystem;
	let store: ContentStore;

	const sampleTask: Task = {
		id: "task-1",
		title: "Sample Task",
		status: "To Do",
		assignee: [],
		createdDate: "2025-09-19 10:00",
		labels: [],
		dependencies: [],
		rawContent: "## Description\nSeed content",
	};

	const sampleDecision: Decision = {
		id: "decision-1",
		title: "Adopt shared cache",
		date: "2025-09-19",
		status: "proposed",
		context: "Context",
		decision: "Decision text",
		consequences: "Consequences",
		rawContent: "## Context\nContext\n\n## Decision\nDecision text\n\n## Consequences\nConsequences",
	};

	const sampleDocument: Document = {
		id: "doc-1",
		title: "Architecture Guide",
		type: "guide",
		createdDate: "2025-09-19",
		rawContent: "# Architecture Guide",
	};

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-content-store");
		filesystem = new FileSystem(TEST_DIR);
		await filesystem.ensureBacklogStructure();
		store = new ContentStore(filesystem);
	});

	afterEach(async () => {
		store?.dispose();
		try {
			await safeCleanup(TEST_DIR);
		} catch {
			// Ignore cleanup errors
		}
	});

	it("loads tasks, documents, and decisions during initialization", async () => {
		await filesystem.saveTask(sampleTask);
		await filesystem.saveDecision(sampleDecision);
		await filesystem.saveDocument(sampleDocument);

		const snapshot = await store.ensureInitialized();

		expect(snapshot.tasks).toHaveLength(1);
		expect(snapshot.documents).toHaveLength(1);
		expect(snapshot.decisions).toHaveLength(1);
		expect(snapshot.tasks.map((task) => task.id)).toContain("TASK-1");
	});

	it("emits task updates when underlying files change", async () => {
		await filesystem.saveTask(sampleTask);
		await store.ensureInitialized();

		const waitForUpdate = waitForEventWithTimeout(store, (event) => {
			return event.type === "tasks" && event.tasks.some((task) => task.title === "Updated Task");
		});

		await filesystem.saveTask({ ...sampleTask, title: "Updated Task" });
		await waitForUpdate;

		const tasks = store.getTasks();
		expect(tasks.map((task) => task.title)).toContain("Updated Task");
	});

	it("updates documents when new files are added", async () => {
		await store.ensureInitialized();

		const waitForDocument = waitForEventWithTimeout(store, (event) => {
			return event.type === "documents" && event.documents.some((doc) => doc.id === "doc-2");
		});

		await filesystem.saveDocument(
			{
				...sampleDocument,
				id: "doc-2",
				title: "Implementation Notes",
				rawContent: "# Implementation Notes",
			},
			"guides",
		);

		await waitForDocument;

		const documents = store.getDocuments();
		expect(documents.some((doc) => doc.id === "doc-2")).toBe(true);
	});

	it("preserves cross-branch tasks from the task loader during refresh", async () => {
		await filesystem.saveTask(sampleTask);

		const remoteTask: Task = {
			id: "task-remote",
			title: "Remote Task",
			status: "In Progress",
			assignee: ["alice"],
			createdDate: "2025-10-01 12:00",
			labels: ["remote"],
			dependencies: [],
			rawContent: "## Description\nRemote content",
			source: "remote",
		};

		let loaderCalls = 0;
		store.dispose();
		store = new ContentStore(filesystem, async () => {
			loaderCalls += 1;
			const localTasks = await filesystem.listTasks();
			return [...localTasks, remoteTask];
		});

		await store.ensureInitialized();
		expect(store.getTasks().map((task) => task.id)).toContain("task-remote");

		await (store as unknown as { refreshTasksFromDisk: () => Promise<void> }).refreshTasksFromDisk();

		const refreshedTasks = store.getTasks();
		expect(refreshedTasks.map((task) => task.id)).toContain("task-remote");
		expect(loaderCalls).toBeGreaterThanOrEqual(2);
	});

	it("refreshes all tasks when watcher event has no filename", async () => {
		await filesystem.saveTask(sampleTask);

		const originalWatch = fs.watch.bind(fs);
		let taskWatcherCallback: ((eventType: string, filename: string | Buffer | null | undefined) => void) | undefined;
		const watchSpy = spyOn(fs, "watch").mockImplementation(((path, options, listener) => {
			const resolvedListener = typeof options === "function" ? options : listener;
			if (resolvedListener && String(path).endsWith("tasks")) {
				taskWatcherCallback = resolvedListener as typeof taskWatcherCallback;
				return { close: () => {}, on: () => {} };
			}
			return originalWatch(path, options as never, listener as never);
		}) as typeof fs.watch);

		store.dispose();
		store = new ContentStore(filesystem, undefined, true);

		try {
			await store.ensureInitialized();

			const secondTask: Task = {
				...sampleTask,
				id: "task-2",
				title: "Second Task",
			};
			await filesystem.saveTask(secondTask);

			const waitForUpdate = waitForEventWithTimeout(store, (event) => {
				return event.type === "tasks" && event.tasks.some((task) => task.id === "TASK-2");
			});

			taskWatcherCallback?.("change", null);
			await waitForUpdate;

			expect(store.getTasks().some((task) => task.id === "TASK-2")).toBe(true);
		} finally {
			watchSpy.mockRestore();
		}
	});

	it("removes decisions when files are deleted", async () => {
		store.dispose();
		store = new ContentStore(filesystem, undefined, true);
		await filesystem.saveDecision(sampleDecision);
		await store.ensureInitialized();

		const decisionsDir = filesystem.decisionsDir;
		const decisionFiles: string[] = [];
		for await (const file of new Bun.Glob("decision-*.md").scan({ cwd: decisionsDir, followSymlinks: true })) {
			decisionFiles.push(file);
		}
		const decisionFile = decisionFiles.find((file) => file.startsWith("decision-1"));
		if (!decisionFile) {
			throw new Error("Expected decision file was not created");
		}

		const waitForRemoval = waitForEventWithTimeout(
			store,
			(event) => {
				return event.type === "decisions" && event.decisions.every((decision) => decision.id !== "decision-1");
			},
			getPlatformTimeout(15000),
		);

		await unlink(join(decisionsDir, decisionFile));
		await waitForRemoval;

		const decisions = store.getDecisions();
		expect(decisions.find((decision) => decision.id === "decision-1")).toBeUndefined();
	});
});

function waitForEventWithTimeout(
	store: ContentStore,
	predicate: (event: ContentStoreEvent) => boolean,
	timeout = getPlatformTimeout(),
): Promise<ContentStoreEvent> {
	const eventPromise = new Promise<ContentStoreEvent>((resolve) => {
		const unsubscribe = store.subscribe((event) => {
			if (!predicate(event)) {
				return;
			}
			unsubscribe();
			resolve(event);
		});
	});

	return Promise.race([
		eventPromise,
		sleep(timeout).then(() => {
			throw new Error("Timed out waiting for content store event");
		}),
	]);
}
