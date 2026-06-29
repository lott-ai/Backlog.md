import { $ } from "bun";

// These will be replaced at build time for compiled executables
declare const __EMBEDDED_VERSION__: string | undefined;
declare const __EMBEDDED_COMMIT__: string | undefined;

const ANSI_GRAY = "\u001B[90m";
const ANSI_RESET = "\u001B[39m";

/**
 * Get the version from package.json or embedded version
 * @returns The version string from package.json or embedded at build time
 */
export async function getVersion(): Promise<string> {
	// If this is a compiled executable with embedded version, use that
	if (typeof __EMBEDDED_VERSION__ !== "undefined") {
		return String(__EMBEDDED_VERSION__);
	}

	// In development, read from package.json
	try {
		const packageJson = await Bun.file("package.json").json();
		return packageJson.version || "0.0.0";
	} catch {
		return "0.0.0";
	}
}

/**
 * Get the short git commit SHA embedded at build time or from the current repo.
 */
export async function getCommitSha(): Promise<string | undefined> {
	if (typeof __EMBEDDED_COMMIT__ !== "undefined") {
		const embedded = String(__EMBEDDED_COMMIT__).trim();
		if (embedded) {
			return embedded;
		}
	}

	try {
		const result = await $`git rev-parse --short HEAD`.quiet().nothrow();
		if (result.exitCode === 0) {
			const sha = result.stdout.toString().trim();
			return sha || undefined;
		}
	} catch {
		// Ignore git lookup failures outside a repository.
	}

	return undefined;
}

/**
 * Format version output for CLI display, optionally including a muted commit SHA.
 */
export async function formatVersionDisplay(options?: { color?: boolean }): Promise<string> {
	const version = await getVersion();
	const commit = await getCommitSha();
	if (!commit) {
		return version;
	}

	const color = options?.color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
	return color ? `${version} ${ANSI_GRAY}(${commit})${ANSI_RESET}` : `${version} (${commit})`;
}
