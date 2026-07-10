import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CLI_PATH = process.env.TUI_TEST_CLI_PATH?.trim() || join(process.cwd(), "src", "cli.ts");
const CLI_RUNTIME = process.env.TUI_TEST_CLI_RUNTIME?.trim() ?? "bun";
const TRANSCRIPT_DIR = join(process.cwd(), "tmp", "tui-interactive-transcripts");

export function getInteractiveTuiSkipReason(): string | null {
	if (process.platform === "win32") {
		return "interactive PTY tests require a Unix-like environment";
	}
	if (process.env.RUN_INTERACTIVE_TUI_TESTS !== "1") {
		return "set RUN_INTERACTIVE_TUI_TESTS=1 to enable interactive PTY tests";
	}
	if (!Bun.which("expect")) {
		return "expect is not installed";
	}
	return null;
}

export function buildInteractiveTuiSpawnCommand(cliArgs: string[]): string {
	const argsSegment = cliArgs.map((arg) => `"${arg}"`).join(" ");
	if (CLI_RUNTIME.length === 0) {
		return `spawn {${CLI_PATH}} ${argsSegment}`;
	}
	return `spawn {${CLI_RUNTIME}} {${CLI_PATH}} ${argsSegment}`;
}

export interface InteractiveTuiRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	transcript: string;
	transcriptPath: string;
}

export async function runInteractiveTuiScenario(options: {
	scenario: string;
	cwd: string;
	buildExpectScript: (context: { transcriptPath: string; spawnCommand: (cliArgs: string[]) => string }) => string;
}): Promise<InteractiveTuiRunResult> {
	await mkdir(TRANSCRIPT_DIR, { recursive: true });
	const transcriptPath = join(TRANSCRIPT_DIR, `${options.scenario}-${Date.now()}.log`);
	const expectScriptPath = join(options.cwd, `${options.scenario}.expect`);
	await writeFile(
		expectScriptPath,
		options.buildExpectScript({ transcriptPath, spawnCommand: buildInteractiveTuiSpawnCommand }),
	);

	const child = Bun.spawn(["expect", "-f", expectScriptPath], {
		cwd: options.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdoutPromise = child.stdout ? new Response(child.stdout).text() : Promise.resolve("");
	const stderrPromise = child.stderr ? new Response(child.stderr).text() : Promise.resolve("");
	const exitCode = await child.exited;
	const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	const transcript = await Bun.file(transcriptPath)
		.text()
		.catch(() => "(no transcript captured)");

	return { exitCode, stdout, stderr, transcript, transcriptPath };
}
