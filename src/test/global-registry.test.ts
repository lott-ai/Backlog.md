import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	addProject,
	addScanIgnore,
	addScanRoot,
	deriveProjectKey,
	listScanIgnores,
	listScanRoots,
	loadGlobalConfig,
	parseGlobalConfig,
	removeProject,
	removeScanIgnore,
	removeScanRoot,
	saveGlobalConfig,
	scanProjects,
	serializeGlobalConfig,
	touchProjectRegistry,
} from "../global/registry.ts";

const TEST_ROOT = join(import.meta.dir, ".tmp-global-registry");
const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;

describe("global registry", () => {
	beforeEach(async () => {
		process.env.XDG_CONFIG_HOME = join(TEST_ROOT, "config");
		await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true });
	});

	afterEach(async () => {
		if (ORIGINAL_XDG === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
		}
		await rm(TEST_ROOT, { recursive: true, force: true });
	});

	it("derives stable project keys with collision suffix", () => {
		const keys = new Set<string>(["backlog-md"]);
		expect(deriveProjectKey("/Users/me/backlog-md", keys)).toMatch(/^backlog-md-[a-f0-9]{6}$/);
	});

	it("serializes and parses global config", () => {
		const config = {
			defaultPort: 6421,
			scanRoots: ["~/github.com"],
			scanIgnores: [],
			projects: [
				{
					key: "demo",
					path: "/tmp/demo",
					name: "Demo",
					lastSeen: "2026-06-28 12:00",
				},
			],
		};
		const parsed = parseGlobalConfig(serializeGlobalConfig(config));
		expect(parsed.defaultPort).toBe(6421);
		expect(parsed.scanRoots[0]).toBe(join(homedir(), "github.com"));
		expect(parsed.projects[0]?.key).toBe("demo");
	});

	it("adds and removes projects", async () => {
		const projectDir = join(TEST_ROOT, "project");
		await mkdir(join(projectDir, "backlog", "tasks"), { recursive: true });
		await Bun.write(join(projectDir, "backlog", "config.yml"), 'project_name: "Registry Test"\nstatuses:\n  - To Do\n');

		const entry = await addProject(projectDir);
		expect(entry.name).toBe("Registry Test");

		const config = await loadGlobalConfig();
		expect(config.projects.some((p) => p.key === entry.key)).toBe(true);

		await removeProject(entry.key);
		const afterRemove = await loadGlobalConfig();
		expect(afterRemove.projects.some((p) => p.key === entry.key)).toBe(false);
	});

	it("lists, adds, and removes scan paths", async () => {
		await saveGlobalConfig({
			defaultPort: 6421,
			scanRoots: ["~/github.com"],
			scanIgnores: [],
			projects: [],
		});

		expect(await listScanRoots()).toEqual([join(homedir(), "github.com")]);

		const added = await addScanRoot("~/projects");
		expect(added).toBe(true);
		expect(await listScanRoots()).toEqual([join(homedir(), "github.com"), join(homedir(), "projects")]);

		const duplicate = await addScanRoot("~/projects");
		expect(duplicate).toBe(false);

		const removed = await removeScanRoot("~/github.com");
		expect(removed).toBe(true);
		expect(await listScanRoots()).toEqual([join(homedir(), "projects")]);

		const missing = await removeScanRoot("~/missing");
		expect(missing).toBe(false);
	});

	it("lists, adds, and removes scan ignore paths", async () => {
		await saveGlobalConfig({
			defaultPort: 6421,
			scanRoots: [],
			scanIgnores: [],
			projects: [],
		});

		const added = await addScanIgnore("~/github.com/MrLesk/Backlog.md/tmp");
		expect(added).toBe(true);
		expect(await listScanIgnores()).toEqual([join(homedir(), "github.com/MrLesk/Backlog.md/tmp")]);

		const duplicate = await addScanIgnore("~/github.com/MrLesk/Backlog.md/tmp");
		expect(duplicate).toBe(false);

		const removed = await removeScanIgnore("~/github.com/MrLesk/Backlog.md/tmp");
		expect(removed).toBe(true);
		expect(await listScanIgnores()).toEqual([]);
	});

	it("skips ignored paths when scanning for projects", async () => {
		const scanRoot = join(TEST_ROOT, "scan-root");
		const includedProject = join(scanRoot, "included");
		const ignoredProject = join(scanRoot, "ignored", "nested");
		for (const projectDir of [includedProject, ignoredProject]) {
			await mkdir(join(projectDir, "backlog", "tasks"), { recursive: true });
			await Bun.write(join(projectDir, "backlog", "config.yml"), 'project_name: "Scan Test"\n');
		}

		await saveGlobalConfig({
			defaultPort: 6421,
			scanRoots: [scanRoot],
			scanIgnores: [join(scanRoot, "ignored")],
			projects: [],
		});

		const found = await scanProjects();
		expect(found.map((project) => project.path)).toEqual([resolve(includedProject)]);
	});

	it("touch updates lastSeen for existing project", async () => {
		const projectDir = join(TEST_ROOT, "touch-project");
		await mkdir(join(projectDir, "backlog", "tasks"), { recursive: true });
		await Bun.write(join(projectDir, "backlog", "config.yml"), 'project_name: "Touch"\n');

		const first = await touchProjectRegistry(projectDir);
		await saveGlobalConfig({
			...(await loadGlobalConfig()),
			projects: [{ ...first, lastSeen: "2000-01-01 00:00" }],
		});
		const second = await touchProjectRegistry(projectDir);
		expect(second.lastSeen).not.toBe("2000-01-01 00:00");
	});
});
