import { describe, expect, it } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import type { BacklogConfig, Task } from "../types/index.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";
import { getInteractiveTuiSkipReason, runInteractiveTuiScenario } from "./tui-interactive-test-utils.ts";

const skipReason = getInteractiveTuiSkipReason();
if (skipReason) {
	console.warn(`[tui-interactive] Skipping interactive editor handoff tests: ${skipReason}`);
}
const itInteractive = skipReason ? it.skip : it;

interface InteractiveEditRunOptions {
	scenario: string;
	cliArgs: string[];
	taskTitle: string;
	readyPattern: string;
}

interface InteractiveEditRunResult {
	taskContent: string;
	transcriptPath: string;
	editorMarker: string;
	editorInputLog: string;
}

async function runInteractiveEditScenario(options: InteractiveEditRunOptions): Promise<InteractiveEditRunResult> {
	const testDir = createUniqueTestDir(`test-tui-interactive-${options.scenario}`);
	await mkdir(testDir, { recursive: true });
	const editorMarkerPath = join(testDir, `${options.scenario}-editor-marker.txt`);
	const editorInputPath = join(testDir, `${options.scenario}-editor-input.log`);
	const editorScriptPath = join(testDir, `${options.scenario}-editor.cjs`);

	await writeFile(
		editorScriptPath,
		`const { appendFileSync, createReadStream } = require("node:fs");

const taskFile = process.argv[2];
const markerFile = process.env.TUI_EDITOR_MARKER_FILE;
const keyLogFile = process.env.TUI_EDITOR_KEY_LOG_FILE;

if (markerFile) {
	appendFileSync(markerFile, "started\\n");
}
if (taskFile) {
	appendFileSync(taskFile, "\\nEdited in interactive TUI test\\n");
}

let input = process.stdin;
if (!input.isTTY) {
	try {
		input = createReadStream("/dev/tty");
	} catch {}
}
if (input.isTTY && typeof input.setRawMode === "function") {
	input.setRawMode(true);
}
input.resume();
input.on("data", (chunk) => {
	if (!keyLogFile) {
		return;
	}
	const bytes = Array.from(chunk.values());
	appendFileSync(keyLogFile, \`DATA:\${bytes.join(",")}\\n\`);
});
process.stdout.write("__EDITOR_READY__\\n");

setTimeout(() => {
	process.exit(0);
}, 1200);
`,
	);

	await $`git init -b main`.cwd(testDir).quiet();
	await $`git config user.email test@example.com`.cwd(testDir).quiet();
	await $`git config user.name "Test User"`.cwd(testDir).quiet();

	const core = new Core(testDir);
	await initializeTestProject(core, `Interactive ${options.scenario}`);

	const config = await core.filesystem.loadConfig();
	if (!config) {
		throw new Error(`Failed to load config for scenario ${options.scenario}`);
	}

	const updatedConfig: BacklogConfig = {
		...config,
		remoteOperations: false,
		checkActiveBranches: false,
		defaultEditor: `node ${editorScriptPath}`,
	};
	await core.filesystem.saveConfig(updatedConfig);

	const task: Task = {
		id: "task-1",
		title: options.taskTitle,
		status: "To Do",
		assignee: [],
		createdDate: "2026-02-11 00:00",
		labels: [],
		dependencies: [],
		description: "TUI interactive editor test",
	};
	await core.createTask(task, false);

	const runResult = await runInteractiveTuiScenario({
		scenario: options.scenario,
		cwd: testDir,
		buildExpectScript: ({ transcriptPath, spawnCommand }) => `#!/usr/bin/expect -f
set timeout 20
log_user 0
log_file -a {${transcriptPath}}
set env(TERM) {xterm-256color}
set env(COLUMNS) {120}
set env(LINES) {40}
set env(NO_COLOR) {1}
set env(EDITOR) {node ${editorScriptPath}}
set env(TUI_EDITOR_MARKER_FILE) {${editorMarkerPath}}
set env(TUI_EDITOR_KEY_LOG_FILE) {${editorInputPath}}
${spawnCommand(options.cliArgs)}
expect {
	-re {${options.readyPattern}} {}
	timeout { exit 91 }
}
sleep 0.5
send -- "E"
expect {
	-re {__EDITOR_READY__} {}
	timeout { exit 92 }
}
send -- "\\033\\[A"
sleep 0.2
send -- "q"
sleep 1.0
send -- "q"
sleep 2.0
send -- "\\003"
expect eof
set wait_status [wait]
set exit_code [lindex $wait_status 3]
exit $exit_code
`,
	});

	try {
		expect([0, 130]).toContain(runResult.exitCode);
	} catch (_error) {
		throw new Error(
			`Interactive CLI run failed for ${options.scenario}.\n` +
				`Exit code: ${runResult.exitCode}\n` +
				`STDOUT:\n${runResult.stdout}\n` +
				`STDERR:\n${runResult.stderr}\n` +
				`Transcript: ${runResult.transcriptPath}\n` +
				`Transcript contents:\n${runResult.transcript}\n`,
		);
	}

	const markerContent = await readFile(editorMarkerPath, "utf8").catch(() => "");
	const editorInputLog = await readFile(editorInputPath, "utf8").catch(() => "");
	const taskContent = await core.getTaskContent("task-1");

	await safeCleanup(testDir);
	return {
		taskContent: taskContent || "",
		transcriptPath: runResult.transcriptPath,
		editorMarker: markerContent,
		editorInputLog,
	};
}

describe("interactive TUI editor handoff", () => {
	itInteractive("launches terminal editor from board view and marks task updated", async () => {
		const result = await runInteractiveEditScenario({
			scenario: "board",
			cliArgs: ["board"],
			taskTitle: "Board interactive editor task",
			readyPattern: "Backlog Board",
		});

		expect(result.editorMarker).toContain("started");
		expect(result.editorInputLog).toContain("DATA:27,91,65");
		expect(result.taskContent).toContain("Edited in interactive TUI test");
		expect(result.transcriptPath).toContain("tui-interactive-transcripts");
	});

	itInteractive("launches terminal editor from task list view and marks task updated", async () => {
		const result = await runInteractiveEditScenario({
			scenario: "task-list",
			cliArgs: ["task", "list"],
			taskTitle: "Task list interactive editor task",
			readyPattern: "Tasks",
		});

		expect(result.editorMarker).toContain("started");
		expect(result.editorInputLog).toContain("DATA:27,91,65");
		expect(result.taskContent).toContain("Edited in interactive TUI test");
		expect(result.transcriptPath).toContain("tui-interactive-transcripts");
	});
});
