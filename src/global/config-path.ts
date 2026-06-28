import { homedir } from "node:os";
import { join } from "node:path";

const GLOBAL_CONFIG_DIR = "backlog";
const GLOBAL_CONFIG_FILE = "global.yml";

/**
 * Primary user-level global config path (XDG or ~/.config).
 */
export function getGlobalConfigPath(): string {
	const xdgConfigHome = process.env.XDG_CONFIG_HOME;
	if (xdgConfigHome) {
		return join(xdgConfigHome, GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE);
	}
	return join(homedir(), ".config", GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE);
}

/** Legacy fallback path for existing installs. */
export function getLegacyGlobalConfigPath(): string {
	return join(homedir(), ".backlog", GLOBAL_CONFIG_FILE);
}
