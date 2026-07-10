import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { Core } from "../core/backlog.ts";
import { BacklogServer } from "../server/index.ts";
import type { Task } from "../types/index.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let server: BacklogServer | null = null;
let serverPort = 0;
let core: Core;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`http://127.0.0.1:${serverPort}${path}`, init);
	if (!response.ok) {
		throw new Error(`${response.status}: ${await response.text()}`);
	}
	return response.json();
}

function makeTask(overrides: Partial<Task>): Task {
	return {
		id: "task-1",
		title: "Task",
		status: "To Do",
		assignee: [],
		labels: [],
		dependencies: [],
		createdDate: "2026-01-01",
		rawContent: "Task body",
		...overrides,
	};
}

describe("BacklogServer cleanup endpoints", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("server-cleanup");
		await mkdir(TEST_DIR, { recursive: true });
		core = new Core(TEST_DIR);
		await core.filesystem.ensureBacklogStructure();
		await core.filesystem.saveConfig({
			projectName: "Server Cleanup",
			statuses: ["To Do", "Review", "Closed"],
			labels: [],
			milestones: [],
			dateFormat: "YYYY-MM-DD",
			remoteOperations: false,
		});

		const oldDate = new Date();
		oldDate.setDate(oldDate.getDate() - 7);
		const oldDateValue = oldDate.toISOString().split("T")[0] as string;
		await core.createTask(
			makeTask({
				id: "task-1",
				title: "Old Closed Task",
				status: "Closed",
				createdDate: oldDateValue,
				updatedDate: oldDateValue,
			}),
			false,
		);
		await core.createTask(
			makeTask({
				id: "task-2",
				title: "Old Literal Done Task",
				status: "Done",
				createdDate: oldDateValue,
				updatedDate: oldDateValue,
			}),
			false,
		);

		server = new BacklogServer(TEST_DIR);
		await server.start(0, false);
		const port = server.getPort();
		expect(port).not.toBeNull();
		serverPort = port ?? 0;

		await retry(async () => {
			await fetchJson<unknown>("/api/tasks/cleanup?age=3");
		});
	});

	afterEach(async () => {
		if (server) {
			await server.stop();
			server = null;
		}
		await safeCleanup(TEST_DIR);
	});

	it("previews and executes cleanup for the final configured status", async () => {
		const preview = await fetchJson<{
			count: number;
			tasks: Array<{ id: string; title: string }>;
			milestoneCount: number;
			milestones: Array<{ id: string; title: string }>;
		}>("/api/tasks/cleanup?age=3");
		expect(preview.count).toBe(1);
		expect(preview.tasks.map((task) => task.id)).toEqual(["TASK-1"]);
		expect(preview.tasks[0]?.title).toBe("Old Closed Task");
		expect(preview.milestoneCount).toBe(0);
		expect(preview.milestones).toEqual([]);

		const result = await fetchJson<{
			success: boolean;
			movedCount: number;
			totalCount: number;
			archivedMilestoneCount?: number;
		}>("/api/tasks/cleanup/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ age: 3 }),
		});
		expect(result.success).toBe(true);
		expect(result.movedCount).toBe(1);
		expect(result.totalCount).toBe(1);
		expect(result.archivedMilestoneCount ?? 0).toBe(0);

		const activeTasks = await core.filesystem.listTasks();
		expect(activeTasks.map((task) => task.id)).toEqual(["TASK-2"]);

		const completedTasks = await core.filesystem.listCompletedTasks();
		expect(completedTasks.map((task) => task.id)).toEqual(["TASK-1"]);
	});

	it("previews and archives completed milestones by age", async () => {
		const oldDate = new Date();
		oldDate.setDate(oldDate.getDate() - 14);
		const oldDateValue = oldDate.toISOString().split("T")[0] as string;

		const milestone = await core.filesystem.createMilestone("Ship It");
		expect(milestone.id).toBeTruthy();

		await core.createTask(
			makeTask({
				id: "task-3",
				title: "Milestone task",
				status: "Closed",
				milestone: milestone.id,
				createdDate: oldDateValue,
				updatedDate: oldDateValue,
			}),
			false,
		);

		const preview = await fetchJson<{
			milestoneCount: number;
			milestones: Array<{ id: string; title: string; taskCount: number }>;
		}>("/api/tasks/cleanup?age=7");
		expect(preview.milestoneCount).toBe(1);
		expect(preview.milestones[0]?.title).toBe("Ship It");
		expect(preview.milestones[0]?.taskCount).toBe(1);

		const result = await fetchJson<{
			success: boolean;
			archivedMilestoneCount?: number;
		}>("/api/tasks/cleanup/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ age: 7 }),
		});
		expect(result.success).toBe(true);
		expect(result.archivedMilestoneCount).toBe(1);

		const active = await core.filesystem.listMilestones();
		expect(active.find((item) => item.title === "Ship It")).toBeUndefined();
		const archived = await core.filesystem.listArchivedMilestones();
		expect(archived.some((item) => item.title === "Ship It")).toBe(true);
	});
});
