import type { Command } from "commander";
import {
	addProject,
	DEFAULT_GLOBAL_PORT,
	listProjects,
	loadGlobalConfig,
	removeProject,
	scanProjects,
} from "../global/registry.ts";
import { GlobalBacklogServer } from "../server/global.ts";
import { InvalidServerPortError, resolveServerPort } from "../utils/resolve-server-port.ts";

export function registerGlobalCommand(program: Command): void {
	const globalCmd = program.command("global").description("cross-project commands");

	const projectsCmd = globalCmd.command("projects").description("manage registered Backlog projects");

	projectsCmd
		.command("list")
		.description("list registered projects")
		.action(async () => {
			try {
				const projects = await listProjects();
				if (projects.length === 0) {
					console.log(
						"No projects registered. Run `backlog global projects add <path>` or use backlog in a project to auto-register.",
					);
					return;
				}
				console.log("Registered projects:\n");
				for (const project of projects) {
					console.log(`  ${project.key}`);
					console.log(`    Name: ${project.name}`);
					console.log(`    Path: ${project.path}`);
					console.log(`    Last seen: ${project.lastSeen}`);
					console.log("");
				}
			} catch (err) {
				console.error("Failed to list projects", err);
				process.exitCode = 1;
			}
		});

	projectsCmd
		.command("add")
		.description("register a project by path")
		.argument("<path>", "project root path")
		.action(async (projectPath: string) => {
			try {
				const entry = await addProject(projectPath);
				console.log(`Registered project ${entry.key} (${entry.name})`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(message);
				process.exitCode = 1;
			}
		});

	projectsCmd
		.command("remove")
		.description("remove a project from the registry")
		.argument("<key>", "project key")
		.action(async (key: string) => {
			try {
				const removed = await removeProject(key);
				if (!removed) {
					console.error(`Project not found: ${key}`);
					process.exitCode = 1;
					return;
				}
				console.log(`Removed project ${key}`);
			} catch (err) {
				console.error("Failed to remove project", err);
				process.exitCode = 1;
			}
		});

	projectsCmd
		.command("scan")
		.description("scan configured or specified directories for Backlog projects")
		.option("--paths <paths>", "comma-separated directories to scan")
		.action(async (options: { paths?: string }) => {
			try {
				const roots = options.paths
					?.split(",")
					.map((p) => p.trim())
					.filter(Boolean);
				const found = await scanProjects(roots);
				if (found.length === 0) {
					console.log("No Backlog projects found.");
					return;
				}
				console.log(`Found ${found.length} project(s):\n`);
				for (const project of found) {
					console.log(`  ${project.key} — ${project.name} (${project.path})`);
				}
			} catch (err) {
				console.error("Failed to scan for projects", err);
				process.exitCode = 1;
			}
		});

	globalCmd
		.command("browser")
		.description("open cross-project dashboard (press Ctrl+C or Cmd+C to stop)")
		.option("-p, --port <port>", "port to run server on")
		.option("--no-open", "don't automatically open browser")
		.action(async (options: { port?: string; open?: boolean }) => {
			try {
				const globalConfig = await loadGlobalConfig();
				const port = resolveServerPort({
					cliPort: options.port,
					configPort: globalConfig.defaultPort,
					fallback: DEFAULT_GLOBAL_PORT,
				});

				const server = new GlobalBacklogServer();
				await server.start(port, options.open !== false);

				let shuttingDown = false;
				const shutdown = async (signal: string) => {
					if (shuttingDown) return;
					shuttingDown = true;
					console.log(`\nReceived ${signal}. Shutting down server...`);
					try {
						const stopPromise = server.stop();
						const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
						await Promise.race([stopPromise, timeout]);
					} finally {
						process.exit(0);
					}
				};

				process.once("SIGINT", () => void shutdown("SIGINT"));
				process.once("SIGTERM", () => void shutdown("SIGTERM"));
				process.once("SIGQUIT", () => void shutdown("SIGQUIT"));
			} catch (err) {
				if (err instanceof InvalidServerPortError) {
					console.error(err.message);
					process.exit(1);
				}
				console.error("Failed to start global browser interface", err);
				process.exitCode = 1;
			}
		});
}
