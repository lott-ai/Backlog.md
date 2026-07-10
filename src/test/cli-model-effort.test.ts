import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;

describe("CLI --model and --effort flags", () => {
	const cliPath = join(process.cwd(), "src", "cli.ts");

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-model-effort");
		try {
			await rm(TEST_DIR, { recursive: true, force: true });
		} catch {}
		await mkdir(TEST_DIR, { recursive: true });

		await $`git init -b main`.cwd(TEST_DIR).quiet();
		await $`git config user.name "Test User"`.cwd(TEST_DIR).quiet();
		await $`git config user.email test@example.com`.cwd(TEST_DIR).quiet();

		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "CLI Model Effort Test");
	});

	afterEach(async () => {
		try {
			await safeCleanup(TEST_DIR);
		} catch {}
	});

	it("creates a task with model and effort", async () => {
		const result = await $`bun ${cliPath} task create "Feature" --model opus --effort high --plain`
			.cwd(TEST_DIR)
			.quiet();

		expect(result.exitCode).toBe(0);
		const out = result.stdout.toString();
		expect(out).toContain("Model: opus");
		expect(out).toContain("Effort: high");
	});

	it("omits model and effort when not provided", async () => {
		const result = await $`bun ${cliPath} task create "Feature" --plain`.cwd(TEST_DIR).quiet();

		expect(result.exitCode).toBe(0);
		const out = result.stdout.toString();
		expect(out).not.toContain("Model:");
		expect(out).not.toContain("Effort:");
	});

	it("edits model and effort on an existing task", async () => {
		await $`bun ${cliPath} task create "Feature" --plain`.cwd(TEST_DIR).quiet();

		const edited = await $`bun ${cliPath} task edit 1 --model sonnet --effort max --plain`.cwd(TEST_DIR).quiet();
		expect(edited.exitCode).toBe(0);
		const editedOut = edited.stdout.toString();
		expect(editedOut).toContain("Model: sonnet");
		expect(editedOut).toContain("Effort: max");
	});

	it("clears model and effort with an empty string", async () => {
		await $`bun ${cliPath} task create "Feature" --model opus --effort high --plain`.cwd(TEST_DIR).quiet();

		const cleared = await $`bun ${cliPath} task edit 1 --model ${""} --effort ${""} --plain`.cwd(TEST_DIR).quiet();
		expect(cleared.exitCode).toBe(0);
		const out = cleared.stdout.toString();
		expect(out).not.toContain("Model:");
		expect(out).not.toContain("Effort:");
	});
});
