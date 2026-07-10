import { describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import type { BacklogConfig, Task } from "../types/index.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";
import { getInteractiveTuiSkipReason, runInteractiveTuiScenario } from "./tui-interactive-test-utils.ts";

const skipReason = getInteractiveTuiSkipReason();
if (skipReason) {
	console.warn(`[tui-interactive] Skipping interactive filter preview tests: ${skipReason}`);
}
const itInteractive = skipReason ? it.skip : it;

async function createFilterPreviewProject(scenario: string): Promise<string> {
	const testDir = createUniqueTestDir(`test-tui-interactive-${scenario}`);
	await mkdir(testDir, { recursive: true });
	await $`git init -b main`.cwd(testDir).quiet();
	await $`git config user.email test@example.com`.cwd(testDir).quiet();
	await $`git config user.name "Test User"`.cwd(testDir).quiet();

	const core = new Core(testDir);
	await initializeTestProject(core, `Interactive ${scenario}`);
	const config = await core.filesystem.loadConfig();
	if (!config) {
		throw new Error(`Failed to load config for scenario ${scenario}`);
	}
	await core.filesystem.saveConfig({
		...config,
		remoteOperations: false,
		checkActiveBranches: false,
	} satisfies BacklogConfig);

	const tasks: Task[] = [
		{
			id: "task-1",
			title: "First task",
			status: "To Do",
			priority: "high",
			assignee: [],
			createdDate: "2026-02-11 00:00",
			labels: ["alpha"],
			milestone: "m-1",
			dependencies: [],
			description: "First interactive filter task",
		},
		{
			id: "task-2",
			title: "Second task",
			status: "In Progress",
			priority: "medium",
			assignee: [],
			createdDate: "2026-02-11 00:00",
			labels: ["beta"],
			milestone: "m-2",
			dependencies: [],
			description: "Second interactive filter task",
		},
		{
			id: "task-3",
			title: "Third task",
			status: "Done",
			priority: "low",
			assignee: [],
			createdDate: "2026-02-11 00:00",
			labels: ["gamma"],
			dependencies: [],
			description: "Third interactive filter task",
		},
	];

	for (const task of tasks) {
		await core.createTask(task, false);
	}
	return testDir;
}

function taskFilterPreview(shortcut: string, previewTaskId: string, cancelKey = "\\033"): string {
	return `
send -- "${shortcut}"
sleep 0.2
send -- " "
expect {
	-re {Task ${previewTaskId}} {}
	timeout { exit 92 }
}
send -- "${cancelKey}"
expect {
	-re {Task TASK-2 - Second task} {}
	timeout { exit 94 }
}
send -- "\\033"
sleep 0.1
send -- "${shortcut}"
sleep 0.2
send -- " "
expect {
	-re {Task ${previewTaskId}} {}
	timeout { exit 97 }
}
send -- "\\r"
expect {
	-re {Task ${previewTaskId}} {}
	timeout { exit 98 }
}
`;
}

function boardFilterPreview(shortcut: string, cancelKey = "\\033"): string {
	return `
send -- "${shortcut}"
sleep 0.2
send -- " "
sleep 0.2
send -- "${cancelKey}"
sleep 0.2
send -- "${shortcut}"
sleep 0.2
send -- " "
sleep 0.2
send -- "\\r"
sleep 0.2
`;
}

async function assertInteractiveRun(
	scenario: string,
	cliArgs: string[],
	readyPattern: string,
	interaction: string,
): Promise<string> {
	const testDir = await createFilterPreviewProject(scenario);
	try {
		const result = await runInteractiveTuiScenario({
			scenario,
			cwd: testDir,
			buildExpectScript: ({ transcriptPath, spawnCommand }) => `#!/usr/bin/expect -f
set timeout 20
log_user 0
log_file -a {${transcriptPath}}
set env(TERM) {xterm-256color}
set env(COLUMNS) {120}
set env(LINES) {40}
set env(NO_COLOR) {1}
${spawnCommand(cliArgs)}
expect {
	-re {${readyPattern}} {}
	timeout { exit 81 }
}
sleep 0.5
${interaction}
send -- "q"
sleep 0.5
send -- "\\003"
expect eof
set wait_status [wait]
set exit_code [lindex $wait_status 3]
exit $exit_code
`,
		});
		if (![0, 130].includes(result.exitCode)) {
			throw new Error(
				`Interactive CLI run failed for ${scenario}.\n` +
					`Exit code: ${result.exitCode}\n` +
					`STDOUT:\n${result.stdout}\n` +
					`STDERR:\n${result.stderr}\n` +
					`Transcript: ${result.transcriptPath}\n` +
					`Transcript contents:\n${result.transcript}\n`,
			);
		}
		expect(result.transcriptPath).toContain("tui-interactive-transcripts");
		return result.transcript;
	} finally {
		await safeCleanup(testDir);
	}
}

describe("interactive TUI filter previews", () => {
	for (const [shortcut, name, previewTaskId, cancelKey] of [
		["s", "status", "TASK-1 - First task", "\\033"],
		["p", "priority", "TASK-1 - First task", "\\033"],
		["i", "milestones", "TASK-3 - Third task", "\\033"],
	] as const) {
		itInteractive(`previews and rolls back the task-list ${name} filter`, async () => {
			const transcript = await assertInteractiveRun(
				`task-list-${name}-filter-preview`,
				["task", "list"],
				"Tasks",
				`send -- "\\033\\[B"${taskFilterPreview(shortcut, previewTaskId, cancelKey)}`,
			);
			expect(transcript).toContain("Task TASK-2 - Second task");
			expect(transcript).toContain(`Task ${previewTaskId}`);
		});
	}

	itInteractive("previews and rolls back the task-list labels filter", async () => {
		const transcript = await assertInteractiveRun(
			"task-list-labels-filter-preview",
			["task", "list"],
			"Tasks",
			`send -- "\\033\\[B"
send -- "/"
sleep 0.1
send -- "\\033\\[C\\033\\[C\\033\\[C\\033\\[C"
sleep 0.1
send -- " "
sleep 0.2
send -- " "
expect {
	-re {Task TASK-1 - First task} {}
	timeout { exit 102 }
}
send -- "q"
expect {
	-re {Task TASK-2 - Second task} {}
	timeout { exit 103 }
}`,
		);
		expect(transcript).toContain("Task TASK-2 - Second task");
		expect(transcript).toContain("Task TASK-1 - First task");
	});

	for (const [shortcut, name, cancelKey] of [
		["p", "priority", "\\033"],
		["f", "labels", "q"],
		["i", "milestones", "\\033"],
	] as const) {
		itInteractive(`keeps the shortcut-opened board ${name} picker active through live rerenders`, async () => {
			const transcript = await assertInteractiveRun(
				`board-${name}-filter-preview`,
				["board"],
				"Backlog Board",
				boardFilterPreview(shortcut, cancelKey),
			);
			expect(transcript).toContain("Backlog Board");
		});
	}
});
