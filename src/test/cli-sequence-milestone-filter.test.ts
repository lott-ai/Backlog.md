import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;

describe("CLI sequence list milestone filtering", () => {
	const cliPath = join(process.cwd(), "src", "cli.ts");

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-sequence-milestone-filter");
		try {
			await rm(TEST_DIR, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
		await mkdir(TEST_DIR, { recursive: true });

		await $`git init -b main`.cwd(TEST_DIR).quiet();
		await $`git config user.name "Test User"`.cwd(TEST_DIR).quiet();
		await $`git config user.email test@example.com`.cwd(TEST_DIR).quiet();

		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "Sequence Milestone Filter Test Project");
		await core.filesystem.createMilestone("Release 1");
		await core.filesystem.createMilestone("Release 2");
		await core.filesystem.createMilestone("Roadmap Alpha");

		await core.createTask(
			{
				id: "task-1",
				title: "Alpha root task",
				status: "To Do",
				assignee: [],
				createdDate: "2025-06-18",
				labels: [],
				dependencies: [],
				description: "Release 1 root",
				milestone: "Release 1",
			},
			false,
		);

		await core.createTask(
			{
				id: "task-2",
				title: "Beta isolated task",
				status: "To Do",
				assignee: [],
				createdDate: "2025-06-18",
				labels: [],
				dependencies: [],
				description: "Release 2 isolated",
				milestone: "Release 2",
			},
			false,
		);

		await core.createTask(
			{
				id: "task-3",
				title: "Alpha dependent task",
				status: "To Do",
				assignee: [],
				createdDate: "2025-06-18",
				labels: [],
				dependencies: ["task-1"],
				description: "Release 1 dependent",
				milestone: "Release 1",
			},
			false,
		);

		await core.createTask(
			{
				id: "task-4",
				title: "Roadmap task",
				status: "To Do",
				assignee: [],
				createdDate: "2025-06-18",
				labels: [],
				dependencies: [],
				description: "Different milestone",
				milestone: "Roadmap Alpha",
			},
			false,
		);
	});

	afterEach(async () => {
		try {
			await safeCleanup(TEST_DIR);
		} catch {
			// Ignore cleanup errors
		}
	});

	it("filters sequences by a single milestone", async () => {
		const result = await $`bun ${cliPath} sequence list --milestone "Release 1" --plain`.cwd(TEST_DIR).quiet();

		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();

		expect(output).toContain("TASK-1 - Alpha root task");
		expect(output).toContain("TASK-3 - Alpha dependent task");
		expect(output).not.toContain("TASK-2 - Beta isolated task");
		expect(output).not.toContain("TASK-4 - Roadmap task");
	});

	it("supports repeatable and comma-separated milestone filters with OR semantics", async () => {
		const result =
			await $`bun ${cliPath} sequence list -m "Release 1" -m "Release 2" --milestone "Roadmap Alpha" --plain`
				.cwd(TEST_DIR)
				.quiet();

		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();

		expect(output).toContain("TASK-1 - Alpha root task");
		expect(output).toContain("TASK-2 - Beta isolated task");
		expect(output).toContain("TASK-3 - Alpha dependent task");
		expect(output).toContain("TASK-4 - Roadmap task");
	});

	it("resolves milestone IDs passed to sequence list", async () => {
		const core = new Core(TEST_DIR);
		const milestones = await core.filesystem.listMilestones();
		const release2 = milestones.find((milestone) => milestone.title === "Release 2");
		if (!release2) {
			throw new Error("Expected Release 2 milestone");
		}

		const result = await $`bun ${cliPath} sequence list -m ${release2.id} --plain`.cwd(TEST_DIR).quiet();

		expect(result.exitCode).toBe(0);
		const output = result.stdout.toString();

		expect(output).toContain("TASK-2 - Beta isolated task");
		expect(output).not.toContain("TASK-1 - Alpha root task");
		expect(output).not.toContain("TASK-3 - Alpha dependent task");
		expect(output).not.toContain("TASK-4 - Roadmap task");
	});
});
