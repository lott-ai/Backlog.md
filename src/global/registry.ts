import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Core } from "../core/backlog.ts";
import { resolveBacklogDirectory } from "../utils/backlog-directory.ts";
import { getGlobalConfigPath, getLegacyGlobalConfigPath } from "./config-path.ts";

export interface RegisteredProject {
	key: string;
	path: string;
	name: string;
	lastSeen: string;
}

export interface GlobalConfig {
	defaultPort: number;
	scanRoots: string[];
	projects: RegisteredProject[];
}

const DEFAULT_GLOBAL_PORT = 6421;

function formatDateTime(date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function expandHome(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

function slugifySegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function deriveProjectKey(projectPath: string, existingKeys: Set<string>): string {
	const base = slugifySegment(basename(projectPath)) || "project";
	if (!existingKeys.has(base)) {
		return base;
	}
	const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 6);
	const withHash = `${base}-${hash}`;
	if (!existingKeys.has(withHash)) {
		return withHash;
	}
	let counter = 2;
	while (existingKeys.has(`${withHash}-${counter}`)) {
		counter += 1;
	}
	return `${withHash}-${counter}`;
}

function parseYamlListBlock(lines: string[], startIndex: number): { items: string[]; nextIndex: number } {
	const items: string[] = [];
	let i = startIndex;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (!line.startsWith("  - ")) {
			break;
		}
		items.push(
			line
				.slice(4)
				.trim()
				.replace(/^['"]|['"]$/g, ""),
		);
		i += 1;
	}
	return { items, nextIndex: i };
}

function parseProjectsBlock(lines: string[], startIndex: number): { projects: RegisteredProject[]; nextIndex: number } {
	const projects: RegisteredProject[] = [];
	let i = startIndex;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (!line.startsWith("  - key:")) {
			break;
		}
		const project: Partial<RegisteredProject> = {
			key: line
				.slice("  - key:".length)
				.trim()
				.replace(/^['"]|['"]$/g, ""),
		};
		i += 1;
		while (i < lines.length && lines[i]?.startsWith("    ")) {
			const fieldLine = lines[i] ?? "";
			const colon = fieldLine.indexOf(":");
			if (colon === -1) {
				break;
			}
			const field = fieldLine.slice(4, colon).trim();
			const value = fieldLine
				.slice(colon + 1)
				.trim()
				.replace(/^['"]|['"]$/g, "");
			if (field === "path") project.path = value;
			if (field === "name") project.name = value;
			if (field === "lastSeen") project.lastSeen = value;
			i += 1;
		}
		if (project.key && project.path && project.name && project.lastSeen) {
			projects.push(project as RegisteredProject);
		}
	}
	return { projects, nextIndex: i };
}

export function parseGlobalConfig(content: string): GlobalConfig {
	const config: GlobalConfig = {
		defaultPort: DEFAULT_GLOBAL_PORT,
		scanRoots: [],
		projects: [],
	};
	const lines = content.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.startsWith("defaultPort:")) {
			const value = Number.parseInt(line.slice("defaultPort:".length).trim(), 10);
			if (!Number.isNaN(value)) {
				config.defaultPort = value;
			}
			continue;
		}
		if (line === "scanRoots:") {
			const parsed = parseYamlListBlock(lines, i + 1);
			config.scanRoots = parsed.items.map(expandHome);
			i = parsed.nextIndex - 1;
			continue;
		}
		if (line === "projects:") {
			const parsed = parseProjectsBlock(lines, i + 1);
			config.projects = parsed.projects;
			i = parsed.nextIndex - 1;
		}
	}
	return config;
}

export function serializeGlobalConfig(config: GlobalConfig): string {
	const lines: string[] = [`defaultPort: ${config.defaultPort}`, "scanRoots:"];
	for (const root of config.scanRoots) {
		lines.push(`  - "${root.replace(/"/g, '\\"')}"`);
	}
	lines.push("projects:");
	for (const project of config.projects) {
		lines.push(`  - key: "${project.key.replace(/"/g, '\\"')}"`);
		lines.push(`    path: "${project.path.replace(/"/g, '\\"')}"`);
		lines.push(`    name: "${project.name.replace(/"/g, '\\"')}"`);
		lines.push(`    lastSeen: "${project.lastSeen.replace(/"/g, '\\"')}"`);
	}
	lines.push("");
	return lines.join("\n");
}

async function readConfigFile(path: string): Promise<GlobalConfig | null> {
	try {
		const file = Bun.file(path);
		if (!(await file.exists())) {
			return null;
		}
		const content = await file.text();
		if (!content.trim()) {
			return null;
		}
		return parseGlobalConfig(content);
	} catch {
		return null;
	}
}

export async function loadGlobalConfig(): Promise<GlobalConfig> {
	const primary = getGlobalConfigPath();
	const legacy = getLegacyGlobalConfigPath();
	const primaryConfig = await readConfigFile(primary);
	if (primaryConfig) {
		return primaryConfig;
	}
	const legacyConfig = await readConfigFile(legacy);
	if (legacyConfig) {
		return legacyConfig;
	}
	return {
		defaultPort: DEFAULT_GLOBAL_PORT,
		scanRoots: [],
		projects: [],
	};
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
	const path = getGlobalConfigPath();
	await mkdir(dirname(path), { recursive: true });
	await Bun.write(path, serializeGlobalConfig(config));
}

async function resolveProjectName(projectRoot: string): Promise<string> {
	try {
		const core = new Core(projectRoot);
		const config = await core.filesystem.loadConfig();
		if (config?.projectName) {
			return config.projectName;
		}
	} catch {
		// fall through
	}
	return basename(projectRoot);
}

export async function touchProjectRegistry(projectRoot: string): Promise<RegisteredProject> {
	const absolutePath = resolve(projectRoot);
	const config = await loadGlobalConfig();
	const existing = config.projects.find((p) => resolve(p.path) === absolutePath);
	const name = await resolveProjectName(absolutePath);
	const lastSeen = formatDateTime();

	if (existing) {
		existing.name = name;
		existing.lastSeen = lastSeen;
		await saveGlobalConfig(config);
		return existing;
	}

	const keys = new Set(config.projects.map((p) => p.key));
	const key = deriveProjectKey(absolutePath, keys);
	const entry: RegisteredProject = {
		key,
		path: absolutePath,
		name,
		lastSeen,
	};
	config.projects.push(entry);
	await saveGlobalConfig(config);
	return entry;
}

export async function listProjects(): Promise<RegisteredProject[]> {
	const config = await loadGlobalConfig();
	return [...config.projects].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export async function addProject(projectPath: string): Promise<RegisteredProject> {
	const absolutePath = resolve(expandHome(projectPath));
	const resolution = resolveBacklogDirectory(absolutePath);
	if (!resolution.configPath) {
		throw new Error(`No Backlog.md project found at ${absolutePath}`);
	}
	return touchProjectRegistry(absolutePath);
}

export async function removeProject(key: string): Promise<boolean> {
	const config = await loadGlobalConfig();
	const index = config.projects.findIndex((p) => p.key === key);
	if (index === -1) {
		return false;
	}
	config.projects.splice(index, 1);
	await saveGlobalConfig(config);
	return true;
}

const SKIP_DIR_NAMES = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"target",
	"vendor",
	".turbo",
	"coverage",
]);

async function scanDirectoryForProjects(
	dir: string,
	found: Map<string, RegisteredProject>,
	depth: number,
	maxDepth: number,
): Promise<void> {
	if (depth > maxDepth) {
		return;
	}
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return;
	}

	const resolution = resolveBacklogDirectory(dir);
	if (resolution.configPath) {
		const entry = await touchProjectRegistry(dir);
		found.set(entry.path, entry);
		return;
	}

	for (const name of entries) {
		if (SKIP_DIR_NAMES.has(name) || name.startsWith(".")) {
			continue;
		}
		const child = join(dir, name);
		try {
			const childStat = await stat(child);
			if (childStat.isDirectory()) {
				await scanDirectoryForProjects(child, found, depth + 1, maxDepth);
			}
		} catch {
			// skip unreadable paths
		}
	}
}

export async function scanProjects(roots?: string[]): Promise<RegisteredProject[]> {
	const config = await loadGlobalConfig();
	const scanRoots = (roots?.length ? roots : config.scanRoots).map((r) => resolve(expandHome(r)));
	const found = new Map<string, RegisteredProject>();

	for (const root of scanRoots) {
		try {
			const rootStat = await stat(root);
			if (!rootStat.isDirectory()) {
				continue;
			}
			await scanDirectoryForProjects(root, found, 0, 8);
		} catch {
			// skip missing roots
		}
	}

	return Array.from(found.values()).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function getProjectByKey(config: GlobalConfig, key: string): RegisteredProject | undefined {
	return config.projects.find((p) => p.key === key);
}

export { DEFAULT_GLOBAL_PORT };
