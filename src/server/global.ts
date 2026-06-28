import { dirname, join } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { $ } from "bun";
import { getTaskStatistics, type TaskStatistics } from "../core/statistics.ts";
import { isCreateLockError } from "../file-system/operations.ts";
import type { RegisteredProject } from "../global/registry.ts";
import { DEFAULT_GLOBAL_PORT } from "../global/registry.ts";
import { BacklogToolError } from "../mcp/errors/mcp-errors.ts";
import { MilestoneHandlers } from "../mcp/tools/milestones/handlers.ts";
import {
	DOCUMENT_TYPE_VALUES,
	type Document,
	type SearchPriorityFilter,
	type SearchResultType,
	type Task,
	type TaskUpdateInput,
} from "../types/index.ts";
import { resolveMilestoneInputForStorage } from "../utils/milestone-storage.ts";
import { getVersion } from "../utils/version.ts";
// @ts-expect-error
import favicon from "../web/favicon.png" with { type: "file" };
import indexHtml from "../web/index.html";
import { GlobalProjectPool } from "./global-project-pool.ts";
import { markHtmlBundleNoStore } from "./index.ts";

const PREFIX_PATTERN = /^[a-zA-Z]+-/i;
const DEFAULT_PREFIX = "task-";
const DOCUMENT_TYPES = new Set<Document["type"]>(DOCUMENT_TYPE_VALUES);

const NO_STORE_HEADERS = {
	"Cache-Control": "no-store, max-age=0, must-revalidate",
	Pragma: "no-cache",
	Expires: "0",
} as const;

function applyNoStoreHeaders(headers: Headers): void {
	for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
		headers.set(name, value);
	}
}

const spaIndexHtml = markHtmlBundleNoStore(indexHtml);

class DocumentPayloadValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DocumentPayloadValidationError";
	}
}

function parseDocumentType(value: unknown): Document["type"] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new DocumentPayloadValidationError("Document type must be a string.");
	}
	if (!DOCUMENT_TYPES.has(value as Document["type"])) {
		throw new DocumentPayloadValidationError(`Document type must be one of: ${DOCUMENT_TYPE_VALUES.join(", ")}.`);
	}
	return value as Document["type"];
}

function parseDocumentTags(value: unknown): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		throw new DocumentPayloadValidationError("Document tags must be an array of strings.");
	}
	if (value.some((tag) => typeof tag !== "string")) {
		throw new DocumentPayloadValidationError("Document tags must be an array of strings.");
	}
	return Array.from(new Set(value.map((tag) => tag.trim()).filter((tag) => tag.length > 0)));
}

function parseCreateDocumentPath(value: unknown): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new DocumentPayloadValidationError("Document path must be a string.");
	}
	return value;
}

function parseUpdateDocumentPath(value: unknown): string | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === null || typeof value === "string") {
		return value;
	}
	throw new DocumentPayloadValidationError("Document path must be a string or null.");
}

function isDocumentValidationError(error: Error): boolean {
	return (
		error instanceof DocumentPayloadValidationError ||
		error.message.startsWith("Document type ") ||
		error.message.startsWith("Document path ") ||
		error.message === "Title is required to create a document." ||
		error.message === "Document title cannot be empty."
	);
}

function stripPrefix(id: string): string {
	return id.replace(PREFIX_PATTERN, "");
}

function ensurePrefix(id: string): string {
	if (PREFIX_PATTERN.test(id)) {
		return id;
	}
	return `${DEFAULT_PREFIX}${id}`;
}

function parseTaskIdSegments(value: string): number[] | null {
	const withoutPrefix = stripPrefix(value);
	if (!/^[0-9]+(?:\.[0-9]+)*$/.test(withoutPrefix)) {
		return null;
	}
	return withoutPrefix.split(".").map((segment) => Number.parseInt(segment, 10));
}

function findTaskByLooseId(tasks: Task[], inputId: string): Task | undefined {
	const lowerInputId = inputId.toLowerCase();
	const exact = tasks.find((task) => task.id.toLowerCase() === lowerInputId);
	if (exact) {
		return exact;
	}

	const inputSegments = parseTaskIdSegments(inputId);
	if (!inputSegments) {
		return undefined;
	}

	return tasks.find((task) => {
		const candidateSegments = parseTaskIdSegments(task.id);
		if (!candidateSegments || candidateSegments.length !== inputSegments.length) {
			return false;
		}
		for (let index = 0; index < candidateSegments.length; index += 1) {
			if (candidateSegments[index] !== inputSegments[index]) {
				return false;
			}
		}
		return true;
	});
}

function mergeTaskStatistics(stats: TaskStatistics[]): TaskStatistics {
	const statusCounts = new Map<string, number>();
	const priorityCounts = new Map<string, number>();
	let totalTasks = 0;
	let completedTasks = 0;
	let draftCount = 0;
	const recentlyCreated: Task[] = [];
	const recentlyUpdated: Task[] = [];
	const staleTasks: Task[] = [];
	const blockedTasks: Task[] = [];
	let totalAge = 0;
	let taskCount = 0;

	for (const stat of stats) {
		for (const [status, count] of stat.statusCounts) {
			statusCounts.set(status, (statusCounts.get(status) ?? 0) + count);
		}
		for (const [priority, count] of stat.priorityCounts) {
			priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + count);
		}
		totalTasks += stat.totalTasks;
		completedTasks += stat.completedTasks;
		draftCount += stat.draftCount;
		recentlyCreated.push(...stat.recentActivity.created);
		recentlyUpdated.push(...stat.recentActivity.updated);
		staleTasks.push(...stat.projectHealth.staleTasks);
		blockedTasks.push(...stat.projectHealth.blockedTasks);
		totalAge += stat.projectHealth.averageTaskAge * stat.totalTasks;
		taskCount += stat.totalTasks;
	}

	recentlyCreated.sort((a, b) => new Date(b.createdDate || 0).getTime() - new Date(a.createdDate || 0).getTime());
	recentlyUpdated.sort((a, b) => new Date(b.updatedDate || 0).getTime() - new Date(a.updatedDate || 0).getTime());

	const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
	const averageTaskAge = taskCount > 0 ? Math.round(totalAge / taskCount) : 0;

	return {
		statusCounts,
		priorityCounts,
		totalTasks,
		completedTasks,
		completionPercentage,
		draftCount,
		recentActivity: {
			created: recentlyCreated.slice(0, 5),
			updated: recentlyUpdated.slice(0, 5),
		},
		projectHealth: {
			averageTaskAge,
			staleTasks: staleTasks.slice(0, 5),
			blockedTasks: blockedTasks.slice(0, 5),
		},
	};
}

export class GlobalBacklogServer {
	private pool = new GlobalProjectPool();
	private server: Server<unknown> | null = null;
	private sockets = new Set<ServerWebSocket<unknown>>();
	private storeSubscriptions = new Map<string, () => void>();
	private _stopping = false;

	getPort(): number | null {
		return this.server?.port ?? null;
	}

	private broadcastTasksUpdated(projectKey?: string) {
		const payload = JSON.stringify({
			type: "tasks-updated",
			...(projectKey ? { projectKey } : {}),
		});
		for (const ws of this.sockets) {
			try {
				ws.send(payload);
			} catch {}
		}
	}

	private async ensureProjectWatched(projectKey: string): Promise<void> {
		if (this.storeSubscriptions.has(projectKey)) {
			return;
		}
		const store = await this.pool.getContentStore(projectKey);
		const unsubscribe = store.subscribe((event) => {
			if (event.type === "ready") {
				return;
			}
			this.broadcastTasksUpdated(projectKey);
		});
		this.storeSubscriptions.set(projectKey, unsubscribe);
	}

	private projectErrorResponse(error: unknown, fallback: string): Response {
		const message = error instanceof Error ? error.message : fallback;
		if (message.startsWith("Unknown project:")) {
			return Response.json({ error: message }, { status: 404 });
		}
		return Response.json({ error: message }, { status: 400 });
	}

	private async resolveProjectKeys(req: Request): Promise<string[] | Response> {
		const config = await this.pool.getConfig();
		const projectsParam = new URL(req.url).searchParams.get("projects");
		const keys = this.pool.parseProjectKeysParam(projectsParam, config);
		for (const key of keys) {
			if (!config.projects.some((project) => project.key === key)) {
				return Response.json({ error: `Unknown project: ${key}` }, { status: 400 });
			}
		}
		return keys;
	}

	private resolveProjectFromParam(projectKey: string): RegisteredProject | Response {
		try {
			return this.pool.resolveProject(projectKey);
		} catch (error) {
			return this.projectErrorResponse(error, "Unknown project");
		}
	}

	private async resolveMilestoneInput(projectKey: string, milestone: string): Promise<string> {
		const core = await this.pool.getCore(projectKey);
		const [activeMilestones, archivedMilestones] = await Promise.all([
			core.filesystem.listMilestones(),
			core.filesystem.listArchivedMilestones(),
		]);
		return resolveMilestoneInputForStorage(milestone, activeMilestones, archivedMilestones);
	}

	private async readOptionalJsonBody(req: Request): Promise<Record<string, unknown>> {
		const text = await req.text();
		if (!text.trim()) {
			return {};
		}

		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw new BacklogToolError("Request body must be valid JSON.", "VALIDATION_ERROR");
		}

		if (!body || typeof body !== "object" || Array.isArray(body)) {
			throw new BacklogToolError("Request body must be a JSON object.", "VALIDATION_ERROR");
		}

		return body as Record<string, unknown>;
	}

	private getMilestoneMutationMessage(result: { content: Array<{ type: string; text?: string }> }): string {
		return result.content
			.filter((item) => item.type === "text" && typeof item.text === "string")
			.map((item) => item.text)
			.join("\n");
	}

	private milestoneMutationErrorResponse(error: unknown, context: string): Response {
		const status =
			error instanceof BacklogToolError
				? error.code === "NOT_FOUND"
					? 404
					: error.code === "VALIDATION_ERROR"
						? 400
						: 500
				: 500;
		const message = error instanceof Error ? error.message : context;
		if (status === 500) {
			console.error(context, error);
		}
		return Response.json(
			{ error: message, code: error instanceof BacklogToolError ? error.code : "INTERNAL_ERROR" },
			{ status },
		);
	}

	async start(port?: number, openBrowser = true): Promise<void> {
		if (this.server) {
			console.log("Server already running");
			return;
		}

		await this.pool.reloadConfig();
		const globalConfig = await this.pool.getConfig();
		const finalPort = port ?? globalConfig.defaultPort ?? DEFAULT_GLOBAL_PORT;

		try {
			const serveOptions = {
				port: finalPort,
				development: process.env.NODE_ENV === "development",
				routes: {
					"/": spaIndexHtml,
					"/tasks": spaIndexHtml,
					"/milestones": spaIndexHtml,
					"/drafts": spaIndexHtml,
					"/documentation": spaIndexHtml,
					"/documentation/*": spaIndexHtml,
					"/decisions": spaIndexHtml,
					"/decisions/*": spaIndexHtml,
					"/statistics": spaIndexHtml,
					"/settings": spaIndexHtml,

					"/api/status": {
						GET: async () => await this.handleGetStatus(),
					},
					"/api/global/projects": {
						GET: async () => await this.handleListProjects(),
					},
					"/api/global/tasks": {
						GET: async (req: Request) => await this.handleListTasks(req),
						POST: async (req: Request) => await this.handleCreateTask(req),
					},
					"/api/global/tasks/reorder": {
						POST: async (req: Request) => await this.handleReorderTask(req),
					},
					"/api/global/tasks/:projectKey/:id": {
						GET: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleGetTask(req.params.projectKey, req.params.id),
						PUT: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleUpdateTask(req, req.params.projectKey, req.params.id),
						DELETE: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleDeleteTask(req.params.projectKey, req.params.id),
					},
					"/api/global/tasks/:projectKey/:id/complete": {
						POST: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleCompleteTask(req.params.projectKey, req.params.id),
					},
					"/api/global/statuses": {
						GET: async (req: Request) => await this.handleGetStatuses(req),
					},
					"/api/global/config": {
						GET: async () => await this.handleGetConfig(),
					},
					"/api/global/docs": {
						GET: async (req: Request) => await this.handleListDocs(req),
					},
					"/api/global/docs/:projectKey": {
						POST: async (req: Request & { params: { projectKey: string } }) =>
							await this.handleCreateDoc(req, req.params.projectKey),
					},
					"/api/global/docs/:projectKey/:id": {
						GET: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleGetDoc(req.params.projectKey, req.params.id),
						PUT: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleUpdateDoc(req, req.params.projectKey, req.params.id),
					},
					"/api/global/decisions": {
						GET: async (req: Request) => await this.handleListDecisions(req),
					},
					"/api/global/decisions/:projectKey": {
						POST: async (req: Request & { params: { projectKey: string } }) =>
							await this.handleCreateDecision(req, req.params.projectKey),
					},
					"/api/global/decisions/:projectKey/:id": {
						GET: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleGetDecision(req.params.projectKey, req.params.id),
						PUT: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleUpdateDecision(req, req.params.projectKey, req.params.id),
					},
					"/api/global/drafts": {
						GET: async (req: Request) => await this.handleListDrafts(req),
					},
					"/api/global/drafts/:projectKey/:id/promote": {
						POST: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handlePromoteDraft(req.params.projectKey, req.params.id),
					},
					"/api/global/milestones": {
						GET: async (req: Request) => await this.handleListMilestones(req),
						POST: async (req: Request) => await this.handleCreateMilestone(req),
					},
					"/api/global/milestones/archived": {
						GET: async (req: Request) => await this.handleListArchivedMilestones(req),
					},
					"/api/global/milestones/:projectKey/:id": {
						GET: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleGetMilestone(req.params.projectKey, req.params.id),
						PUT: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleUpdateMilestone(req, req.params.projectKey, req.params.id),
						DELETE: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleRemoveMilestone(req, req.params.projectKey, req.params.id),
					},
					"/api/global/milestones/:projectKey/:id/archive": {
						POST: async (req: Request & { params: { projectKey: string; id: string } }) =>
							await this.handleArchiveMilestone(req.params.projectKey, req.params.id),
					},
					"/api/global/version": {
						GET: async () => await this.handleGetVersion(),
					},
					"/api/global/statistics": {
						GET: async (req: Request) => await this.handleGetStatistics(req),
					},
					"/api/global/search": {
						GET: async (req: Request) => await this.handleSearch(req),
					},
				},
				fetch: async (req: Request, server: Server<unknown>) => {
					const res = await this.handleRequest(req, server);
					if (req.method === "GET" || req.method === "HEAD") {
						applyNoStoreHeaders(res.headers);
					}
					return res;
				},
				error: this.handleError.bind(this),
				websocket: {
					open: (ws: ServerWebSocket) => {
						this.sockets.add(ws);
					},
					message(ws: ServerWebSocket) {
						ws.send("pong");
					},
					close: (ws: ServerWebSocket) => {
						this.sockets.delete(ws);
					},
				},
				/* biome-ignore format: keep cast on single line below for type narrowing */
			};
			this.server = Bun.serve(serveOptions as unknown as Parameters<typeof Bun.serve>[0]);

			const url = `http://localhost:${finalPort}`;
			console.log(`🚀 Backlog.md browser interface running at ${url}`);
			console.log("📊 Global dashboard");
			const stopKey = process.platform === "darwin" ? "Cmd+C" : "Ctrl+C";
			console.log(`⏹️  Press ${stopKey} to stop the server`);

			if (openBrowser) {
				console.log("🌐 Opening browser...");
				await this.openBrowser(url);
			} else {
				console.log("💡 Open your browser and navigate to the URL above");
			}
		} catch (error) {
			const errorCode = (error as { code?: string })?.code;
			const errorMessage = (error as Error)?.message;
			if (errorCode === "EADDRINUSE" || errorMessage?.includes("address already in use")) {
				console.error(`\n❌ Error: Port ${finalPort} is already in use.\n`);
				console.log("💡 Suggestions:");
				console.log(`   1. Try a different port: backlog global browser --port ${finalPort + 1}`);
				console.log(`   2. Find what's using port ${finalPort}:`);
				if (process.platform === "darwin" || process.platform === "linux") {
					console.log(`      Run: lsof -i :${finalPort}`);
				} else if (process.platform === "win32") {
					console.log(`      Run: netstat -ano | findstr :${finalPort}`);
				}
				console.log("   3. Or kill the process using the port and try again\n");
				process.exit(1);
			}

			console.error("❌ Failed to start server:", errorMessage || error);
			process.exit(1);
		}
	}

	async stop(): Promise<void> {
		if (this._stopping) return;
		this._stopping = true;

		for (const unsubscribe of this.storeSubscriptions.values()) {
			try {
				unsubscribe();
			} catch {}
		}
		this.storeSubscriptions.clear();

		await this.pool.dispose();

		for (const ws of this.sockets) {
			try {
				ws.close();
			} catch {}
		}
		this.sockets.clear();

		if (this.server) {
			const serverRef = this.server;
			const stopPromise = (async () => {
				try {
					await serverRef.stop();
				} catch {}
			})();
			const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
			await Promise.race([stopPromise, timeout]);
			this.server = null;
			console.log("Server stopped");
		}

		this._stopping = false;
	}

	private async openBrowser(url: string): Promise<void> {
		try {
			const platform = process.platform;
			let cmd: string[];

			switch (platform) {
				case "darwin":
					cmd = ["open", url];
					break;
				case "win32":
					cmd = ["cmd", "/c", "start", "", url];
					break;
				default:
					cmd = ["xdg-open", url];
					break;
			}

			await $`${cmd}`.quiet();
		} catch (error) {
			console.warn("⚠️  Failed to open browser automatically:", error);
			console.log("💡 Please open your browser manually and navigate to the URL above");
		}
	}

	private async handleRequest(req: Request, server: Server<unknown>): Promise<Response> {
		const url = new URL(req.url);
		const pathname = url.pathname;

		if (req.headers.get("upgrade") === "websocket") {
			const success = server.upgrade(req, { data: undefined });
			if (success) {
				return new Response(null, { status: 101 });
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		if (pathname.startsWith("/favicon")) {
			const faviconFile = Bun.file(favicon);
			return new Response(faviconFile, {
				headers: { "Content-Type": "image/png" },
			});
		}

		if (pathname.startsWith("/api/global/assets/")) {
			return await this.handleGlobalAssetRequest(req);
		}

		return new Response("Not Found", { status: 404 });
	}

	private async handleGlobalAssetRequest(req: Request): Promise<Response> {
		try {
			const url = new URL(req.url);
			const pathname = decodeURIComponent(url.pathname || "");
			const prefix = "/api/global/assets/";
			if (!pathname.startsWith(prefix)) return new Response("Not Found", { status: 404 });

			const remainder = pathname.slice(prefix.length);
			const slashIndex = remainder.indexOf("/");
			if (slashIndex === -1) return new Response("Not Found", { status: 404 });

			const projectKey = remainder.slice(0, slashIndex);
			const relPath = remainder.slice(slashIndex + 1);
			if (relPath.includes("..")) return new Response("Not Found", { status: 404 });

			const project = this.resolveProjectFromParam(projectKey);
			if (project instanceof Response) {
				return project;
			}

			const core = await this.pool.getCore(projectKey);
			const docsDir = core.filesystem.docsDir;
			const backlogRoot = dirname(docsDir);
			const assetsRoot = join(backlogRoot, "assets");
			const filePath = join(assetsRoot, relPath);

			if (!filePath.startsWith(assetsRoot)) return new Response("Not Found", { status: 404 });

			const file = Bun.file(filePath);
			if (!(await file.exists())) return new Response("Not Found", { status: 404 });

			const ext = (filePath.match(/\.([^./]+)$/) || [])[1]?.toLowerCase() || "";
			const mimeMap: Record<string, string> = {
				png: "image/png",
				jpg: "image/jpeg",
				jpeg: "image/jpeg",
				gif: "image/gif",
				svg: "image/svg+xml",
				webp: "image/webp",
				avif: "image/avif",
				pdf: "application/pdf",
				txt: "text/plain",
				css: "text/css",
				js: "application/javascript",
			};

			const mime = mimeMap[ext] ?? "application/octet-stream";
			return new Response(file, { headers: { "Content-Type": mime } });
		} catch (error) {
			console.error("Error serving global asset:", error);
			return new Response("Internal Server Error", { status: 500 });
		}
	}

	private handleError(error: Error): Response {
		console.error("Server Error:", error);
		return new Response("Internal Server Error", { status: 500 });
	}

	private async handleGetStatus(): Promise<Response> {
		const projects = await this.pool.listProjectSummaries();
		return Response.json({
			mode: "global",
			initialized: true,
			projects,
		});
	}

	private async handleListProjects(): Promise<Response> {
		const projects = await this.pool.listProjectSummaries();
		return Response.json(projects);
	}

	private async handleListTasks(req: Request): Promise<Response> {
		const keys = await this.resolveProjectKeys(req);
		if (keys instanceof Response) {
			return keys;
		}

		const url = new URL(req.url);
		const status = url.searchParams.get("status") || undefined;
		const assignee = url.searchParams.get("assignee") || undefined;
		const parent = url.searchParams.get("parent") || undefined;
		const priorityParam = url.searchParams.get("priority") || undefined;
		const crossBranch = url.searchParams.get("crossBranch") === "true";
		const labelParams = [...url.searchParams.getAll("label"), ...url.searchParams.getAll("labels")];
		const labelsCsv = url.searchParams.get("labels");
		if (labelsCsv) {
			labelParams.push(...labelsCsv.split(","));
		}
		const labels = labelParams.map((label) => label.trim()).filter((label) => label.length > 0);

		let priority: "high" | "medium" | "low" | undefined;
		if (priorityParam) {
			const normalizedPriority = priorityParam.toLowerCase();
			const allowed = ["high", "medium", "low"];
			if (!allowed.includes(normalizedPriority)) {
				return Response.json({ error: "Invalid priority filter" }, { status: 400 });
			}
			priority = normalizedPriority as "high" | "medium" | "low";
		}

		const allTasks = [];
		for (const projectKey of keys) {
			try {
				const project = this.pool.resolveProject(projectKey);
				await this.ensureProjectWatched(projectKey);
				const core = await this.pool.getCore(projectKey);

				let parentTaskId: string | undefined;
				if (parent) {
					const store = await this.pool.getContentStore(projectKey);
					const allProjectTasks = store.getTasks();
					let parentTask = findTaskByLooseId(allProjectTasks, parent);
					if (!parentTask) {
						const fallbackId = ensurePrefix(parent);
						const fallback = await core.filesystem.loadTask(fallbackId);
						if (fallback) {
							store.upsertTask(fallback);
							parentTask = fallback;
						}
					}
					if (!parentTask) {
						continue;
					}
					parentTaskId = parentTask.id;
				}

				const tasks = await core.queryTasks({
					filters: { status, assignee, priority, parentTaskId, labels: labels.length > 0 ? labels : undefined },
					includeCrossBranch: crossBranch,
				});
				for (const task of tasks) {
					allTasks.push(this.pool.tagWithProject(project, task));
				}
			} catch (error) {
				console.error(`Error listing tasks for ${projectKey}:`, error);
			}
		}

		return Response.json(allTasks);
	}

	private async handleCreateTask(req: Request): Promise<Response> {
		const payload = await req.json();
		const projectKey = typeof payload?.projectKey === "string" ? payload.projectKey : "";
		if (!projectKey) {
			return Response.json({ error: "projectKey is required" }, { status: 400 });
		}

		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		if (!payload || typeof payload.title !== "string" || payload.title.trim().length === 0) {
			return Response.json({ error: "Title is required" }, { status: 400 });
		}

		const acceptanceCriteria = Array.isArray(payload.acceptanceCriteriaItems)
			? payload.acceptanceCriteriaItems
					.map((item: { text?: string; checked?: boolean }) => ({
						text: String(item?.text ?? "").trim(),
						checked: Boolean(item?.checked),
					}))
					.filter((item: { text: string }) => item.text.length > 0)
			: [];
		const definitionOfDoneAdd = Array.isArray(payload.definitionOfDoneAdd)
			? payload.definitionOfDoneAdd
					.map((item: unknown) => String(item ?? "").trim())
					.filter((item: string) => item.length > 0)
			: [];
		const disableDefinitionOfDoneDefaults = Boolean(payload.disableDefinitionOfDoneDefaults);

		try {
			await this.ensureProjectWatched(projectKey);
			const core = await this.pool.getCore(projectKey);
			const milestone =
				typeof payload.milestone === "string"
					? await this.resolveMilestoneInput(projectKey, payload.milestone)
					: undefined;

			const { task: createdTask } = await core.createTaskFromInput({
				title: payload.title,
				description: payload.description,
				status: payload.status,
				priority: payload.priority,
				milestone,
				labels: payload.labels,
				assignee: payload.assignee,
				dependencies: payload.dependencies,
				references: payload.references,
				modifiedFiles: payload.modifiedFiles,
				parentTaskId: payload.parentTaskId,
				implementationPlan: payload.implementationPlan,
				implementationNotes: payload.implementationNotes,
				finalSummary: payload.finalSummary,
				acceptanceCriteria,
				definitionOfDoneAdd,
				disableDefinitionOfDoneDefaults,
			});
			this.broadcastTasksUpdated(projectKey);
			return Response.json(this.pool.tagWithProject(project, createdTask), { status: 201 });
		} catch (error) {
			if (isCreateLockError(error)) {
				const message = error instanceof Error ? error.message : "Failed to create task";
				return Response.json({ error: message }, { status: 409 });
			}
			const message = error instanceof Error ? error.message : "Failed to create task";
			return Response.json({ error: message }, { status: 400 });
		}
	}

	private async handleGetTask(projectKey: string, taskId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			await this.ensureProjectWatched(projectKey);
			const core = await this.pool.getCore(projectKey);
			const store = await this.pool.getContentStore(projectKey);

			const localTask = await core.filesystem.loadTask(taskId);
			if (localTask) {
				store.upsertTask(localTask);
				return Response.json(this.pool.tagWithProject(project, localTask));
			}

			const task = findTaskByLooseId(store.getTasks(), taskId);
			if (task) {
				return Response.json(this.pool.tagWithProject(project, task));
			}

			return Response.json({ error: "Task not found" }, { status: 404 });
		} catch (error) {
			return this.projectErrorResponse(error, "Failed to load task");
		}
	}

	private async handleUpdateTask(req: Request, projectKey: string, taskId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		const updates = await req.json();
		const core = await this.pool.getCore(projectKey);
		const existingTask = await core.filesystem.loadTask(taskId);
		if (!existingTask) {
			return Response.json({ error: "Task not found" }, { status: 404 });
		}

		const updateInput: TaskUpdateInput = {};

		if ("title" in updates && typeof updates.title === "string") {
			updateInput.title = updates.title;
		}

		if ("description" in updates && typeof updates.description === "string") {
			updateInput.description = updates.description;
		}

		if ("status" in updates && typeof updates.status === "string") {
			updateInput.status = updates.status;
		}

		if ("priority" in updates && typeof updates.priority === "string") {
			updateInput.priority = updates.priority;
		}

		if ("milestone" in updates && (typeof updates.milestone === "string" || updates.milestone === null)) {
			if (typeof updates.milestone === "string") {
				updateInput.milestone = await this.resolveMilestoneInput(projectKey, updates.milestone);
			} else {
				updateInput.milestone = updates.milestone;
			}
		}

		if ("labels" in updates && Array.isArray(updates.labels)) {
			updateInput.labels = updates.labels;
		}

		if ("assignee" in updates && Array.isArray(updates.assignee)) {
			updateInput.assignee = updates.assignee;
		}

		if ("dependencies" in updates && Array.isArray(updates.dependencies)) {
			updateInput.dependencies = updates.dependencies;
		}

		if ("references" in updates && Array.isArray(updates.references)) {
			updateInput.references = updates.references;
		}

		if ("modifiedFiles" in updates && Array.isArray(updates.modifiedFiles)) {
			updateInput.modifiedFiles = updates.modifiedFiles;
		}

		if ("implementationPlan" in updates && typeof updates.implementationPlan === "string") {
			updateInput.implementationPlan = updates.implementationPlan;
		}

		if ("implementationNotes" in updates && typeof updates.implementationNotes === "string") {
			updateInput.implementationNotes = updates.implementationNotes;
		}

		if ("commentsAppend" in updates && Array.isArray(updates.commentsAppend)) {
			const author =
				typeof updates.commentAuthor === "string" && updates.commentAuthor.trim().length > 0
					? updates.commentAuthor.trim()
					: undefined;
			updateInput.appendComments = updates.commentsAppend
				.map((body: unknown) => ({
					body: String(body ?? "").trim(),
					...(author && { author }),
				}))
				.filter((comment: { body: string }) => comment.body.length > 0);
		}

		if ("finalSummary" in updates && typeof updates.finalSummary === "string") {
			updateInput.finalSummary = updates.finalSummary;
		}

		if ("acceptanceCriteriaItems" in updates && Array.isArray(updates.acceptanceCriteriaItems)) {
			updateInput.acceptanceCriteria = updates.acceptanceCriteriaItems
				.map((item: { text?: string; checked?: boolean }) => ({
					text: String(item?.text ?? "").trim(),
					checked: Boolean(item?.checked),
				}))
				.filter((item: { text: string }) => item.text.length > 0);
		}

		if ("definitionOfDoneAdd" in updates && Array.isArray(updates.definitionOfDoneAdd)) {
			updateInput.addDefinitionOfDone = updates.definitionOfDoneAdd
				.map((item: unknown) => ({ text: String(item ?? "").trim(), checked: false }))
				.filter((item: { text: string }) => item.text.length > 0);
		}

		if ("definitionOfDoneRemove" in updates && Array.isArray(updates.definitionOfDoneRemove)) {
			updateInput.removeDefinitionOfDone = updates.definitionOfDoneRemove.filter(
				(value: unknown) => typeof value === "number" && Number.isFinite(value),
			);
		}

		if ("definitionOfDoneCheck" in updates && Array.isArray(updates.definitionOfDoneCheck)) {
			updateInput.checkDefinitionOfDone = updates.definitionOfDoneCheck.filter(
				(value: unknown) => typeof value === "number" && Number.isFinite(value),
			);
		}

		if ("definitionOfDoneUncheck" in updates && Array.isArray(updates.definitionOfDoneUncheck)) {
			updateInput.uncheckDefinitionOfDone = updates.definitionOfDoneUncheck.filter(
				(value: unknown) => typeof value === "number" && Number.isFinite(value),
			);
		}

		try {
			await this.ensureProjectWatched(projectKey);
			const updatedTask = await core.updateTaskFromInput(taskId, updateInput);
			this.broadcastTasksUpdated(projectKey);
			return Response.json(this.pool.tagWithProject(project, updatedTask));
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to update task";
			return Response.json({ error: message }, { status: 400 });
		}
	}

	private async handleDeleteTask(projectKey: string, taskId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const core = await this.pool.getCore(projectKey);
			const success = await core.archiveTask(taskId);
			if (!success) {
				return Response.json({ error: "Task not found" }, { status: 404 });
			}
			this.broadcastTasksUpdated(projectKey);
			return Response.json({ success: true });
		} catch (error) {
			return this.projectErrorResponse(error, "Failed to delete task");
		}
	}

	private async handleCompleteTask(projectKey: string, taskId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const core = await this.pool.getCore(projectKey);
			const task = await core.filesystem.loadTask(taskId);
			if (!task) {
				return Response.json({ error: "Task not found" }, { status: 404 });
			}

			const success = await core.completeTask(taskId);
			if (!success) {
				return Response.json({ error: "Failed to complete task" }, { status: 500 });
			}

			this.broadcastTasksUpdated(projectKey);
			return Response.json({ success: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to complete task";
			console.error("Error completing task:", error);
			return Response.json({ error: message }, { status: 500 });
		}
	}

	private async handleReorderTask(req: Request): Promise<Response> {
		try {
			const body = await req.json();
			const projectKey = typeof body.projectKey === "string" ? body.projectKey : "";
			if (!projectKey) {
				return Response.json({ error: "projectKey is required" }, { status: 400 });
			}

			const project = this.resolveProjectFromParam(projectKey);
			if (project instanceof Response) {
				return project;
			}

			const taskId = typeof body.taskId === "string" ? body.taskId : "";
			const targetStatus = typeof body.targetStatus === "string" ? body.targetStatus : "";
			const orderedTaskIds = Array.isArray(body.orderedTaskIds) ? body.orderedTaskIds : [];
			const targetMilestone =
				typeof body.targetMilestone === "string"
					? body.targetMilestone
					: body.targetMilestone === null
						? null
						: undefined;

			if (!taskId || !targetStatus || orderedTaskIds.length === 0) {
				return Response.json(
					{ error: "Missing required fields: taskId, targetStatus, and orderedTaskIds" },
					{ status: 400 },
				);
			}

			const core = await this.pool.getCore(projectKey);
			const { updatedTask } = await core.reorderTask({
				taskId,
				targetStatus,
				orderedTaskIds,
				targetMilestone,
				commitMessage: `Reorder tasks in ${targetStatus}`,
			});

			this.broadcastTasksUpdated(projectKey);
			return Response.json({ success: true, task: this.pool.tagWithProject(project, updatedTask) });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to reorder task";
			const isCrossBranchError = message.includes("exists in branch");
			const isValidationError = message.includes("not found") || message.includes("Missing required");
			const status = isCrossBranchError || isValidationError ? 400 : 500;
			if (status === 500) {
				console.error("Error reordering task:", error);
			}
			return Response.json({ error: message }, { status });
		}
	}

	private async handleGetStatuses(req: Request): Promise<Response> {
		const keys = await this.resolveProjectKeys(req);
		if (keys instanceof Response) {
			return keys;
		}

		const seen = new Set<string>();
		const statuses: string[] = [];
		for (const projectKey of keys) {
			try {
				const core = await this.pool.getCore(projectKey);
				const config = await core.filesystem.loadConfig();
				for (const status of config?.statuses ?? ["To Do", "In Progress", "Done"]) {
					if (!seen.has(status)) {
						seen.add(status);
						statuses.push(status);
					}
				}
			} catch (error) {
				console.error(`Error loading statuses for ${projectKey}:`, error);
			}
		}
		return Response.json(statuses);
	}

	private async handleGetConfig(): Promise<Response> {
		const config = await this.pool.getConfig();
		return Response.json({
			defaultPort: config.defaultPort,
			scanRoots: config.scanRoots,
			projects: config.projects,
		});
	}

	private async handleListDocs(req: Request): Promise<Response> {
		const keys = await this.resolveProjectKeys(req);
		if (keys instanceof Response) {
			return keys;
		}

		const docFiles = [];
		for (const projectKey of keys) {
			try {
				const project = this.pool.resolveProject(projectKey);
				await this.ensureProjectWatched(projectKey);
				const store = await this.pool.getContentStore(projectKey);
				for (const doc of store.getDocuments()) {
					docFiles.push(
						this.pool.tagWithProject(project, {
							name: doc.path?.split(/[\\/]+/).pop() ?? `${doc.title}.md`,
							id: doc.id,
							title: doc.title,
							type: doc.type,
							path: doc.path,
							createdDate: doc.createdDate,
							updatedDate: doc.updatedDate,
							lastModified: doc.updatedDate || doc.createdDate,
							tags: doc.tags || [],
						}),
					);
				}
			} catch (error) {
				console.error(`Error listing docs for ${projectKey}:`, error);
			}
		}
		return Response.json(docFiles);
	}

	private async handleGetDoc(projectKey: string, docId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const core = await this.pool.getCore(projectKey);
			const doc = await core.getDocument(docId);
			if (!doc) {
				return Response.json({ error: "Document not found" }, { status: 404 });
			}
			return Response.json(this.pool.tagWithProject(project, doc));
		} catch (error) {
			console.error("Error loading document:", error);
			return Response.json({ error: "Document not found" }, { status: 404 });
		}
	}

	private async handleCreateDoc(req: Request, projectKey: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const body = await req.json();
			const filename = typeof body?.filename === "string" ? body.filename : undefined;
			const title = typeof body?.title === "string" ? body.title : filename?.replace(/\.md$/i, "");
			if (!title || title.trim().length === 0) {
				return Response.json({ error: "Document title is required" }, { status: 400 });
			}
			const type = parseDocumentType(body?.type);
			const path = parseCreateDocumentPath(body?.path);
			const tags = parseDocumentTags(body?.tags);

			const core = await this.pool.getCore(projectKey);
			const document = await core.createDocumentFromInput({
				title,
				content: typeof body?.content === "string" ? body.content : "",
				type,
				path,
				tags,
			});
			this.broadcastTasksUpdated(projectKey);
			return Response.json({ success: true, ...this.pool.tagWithProject(project, document) }, { status: 201 });
		} catch (error) {
			if (error instanceof SyntaxError) {
				return Response.json({ error: "Invalid request payload" }, { status: 400 });
			}
			if (error instanceof Error && isDocumentValidationError(error)) {
				return Response.json({ error: error.message }, { status: 400 });
			}
			console.error("Error creating document:", error);
			return Response.json({ error: "Failed to create document" }, { status: 500 });
		}
	}

	private async handleUpdateDoc(req: Request, projectKey: string, docId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const body = await req.json();
			const content = typeof body?.content === "string" ? body.content : undefined;
			const title = typeof body?.title === "string" ? body.title : undefined;
			const path = parseUpdateDocumentPath(body?.path);
			const type = parseDocumentType(body?.type);
			const tags = parseDocumentTags(body?.tags);

			if (typeof content !== "string") {
				return Response.json({ error: "Document content is required" }, { status: 400 });
			}

			let normalizedTitle: string | undefined;
			if (typeof title === "string") {
				normalizedTitle = title.trim();
				if (normalizedTitle.length === 0) {
					return Response.json({ error: "Document title cannot be empty" }, { status: 400 });
				}
			}

			const core = await this.pool.getCore(projectKey);
			const document = await core.updateDocumentFromInput({
				id: docId,
				content,
				...(normalizedTitle && { title: normalizedTitle }),
				...(path !== undefined && { path }),
				...(type !== undefined && { type }),
				...(tags !== undefined && { tags }),
			});
			this.broadcastTasksUpdated(projectKey);
			return Response.json({ success: true, ...this.pool.tagWithProject(project, document) });
		} catch (error) {
			if (error instanceof SyntaxError) {
				return Response.json({ error: "Invalid request payload" }, { status: 400 });
			}
			if (error instanceof Error) {
				if (error.message.startsWith("Document not found")) {
					return Response.json({ error: error.message }, { status: 404 });
				}
				if (isDocumentValidationError(error)) {
					return Response.json({ error: error.message }, { status: 400 });
				}
			}
			console.error("Error updating document:", error);
			return Response.json({ error: "Failed to update document" }, { status: 500 });
		}
	}

	private async handleListDecisions(req: Request): Promise<Response> {
		const keys = await this.resolveProjectKeys(req);
		if (keys instanceof Response) {
			return keys;
		}

		const decisionFiles = [];
		for (const projectKey of keys) {
			try {
				const project = this.pool.resolveProject(projectKey);
				await this.ensureProjectWatched(projectKey);
				const store = await this.pool.getContentStore(projectKey);
				for (const decision of store.getDecisions()) {
					decisionFiles.push(
						this.pool.tagWithProject(project, {
							id: decision.id,
							title: decision.title,
							status: decision.status,
							date: decision.date,
							context: decision.context,
							decision: decision.decision,
							consequences: decision.consequences,
							alternatives: decision.alternatives,
						}),
					);
				}
			} catch (error) {
				console.error(`Error listing decisions for ${projectKey}:`, error);
			}
		}
		return Response.json(decisionFiles);
	}

	private async handleGetDecision(projectKey: string, decisionId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const store = await this.pool.getContentStore(projectKey);
			const normalizedId = decisionId.startsWith("decision-") ? decisionId : `decision-${decisionId}`;
			const decision = store.getDecisions().find((item) => item.id === normalizedId || item.id === decisionId);

			if (!decision) {
				return Response.json({ error: "Decision not found" }, { status: 404 });
			}

			return Response.json(this.pool.tagWithProject(project, decision));
		} catch (error) {
			console.error("Error loading decision:", error);
			return Response.json({ error: "Decision not found" }, { status: 404 });
		}
	}

	private async handleCreateDecision(req: Request, projectKey: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		const { title } = await req.json();
		try {
			const core = await this.pool.getCore(projectKey);
			const decision = await core.createDecisionWithTitle(title);
			this.broadcastTasksUpdated(projectKey);
			return Response.json(this.pool.tagWithProject(project, decision), { status: 201 });
		} catch (error) {
			console.error("Error creating decision:", error);
			return Response.json({ error: "Failed to create decision" }, { status: 500 });
		}
	}

	private async handleUpdateDecision(req: Request, projectKey: string, decisionId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		const content = await req.text();
		try {
			const core = await this.pool.getCore(projectKey);
			await core.updateDecisionFromContent(decisionId, content);
			this.broadcastTasksUpdated(projectKey);
			return Response.json({ success: true });
		} catch (error) {
			if (error instanceof Error && error.message.includes("not found")) {
				return Response.json({ error: "Decision not found" }, { status: 404 });
			}
			console.error("Error updating decision:", error);
			return Response.json({ error: "Failed to update decision" }, { status: 500 });
		}
	}

	private async handleListDrafts(req: Request): Promise<Response> {
		const keys = await this.resolveProjectKeys(req);
		if (keys instanceof Response) {
			return keys;
		}

		const allDrafts = [];
		for (const projectKey of keys) {
			try {
				const project = this.pool.resolveProject(projectKey);
				const core = await this.pool.getCore(projectKey);
				const drafts = await core.filesystem.listDrafts();
				for (const draft of drafts) {
					allDrafts.push(this.pool.tagWithProject(project, draft));
				}
			} catch (error) {
				console.error(`Error listing drafts for ${projectKey}:`, error);
			}
		}
		return Response.json(allDrafts);
	}

	private async handlePromoteDraft(projectKey: string, draftId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const core = await this.pool.getCore(projectKey);
			const success = await core.promoteDraft(draftId);
			if (!success) {
				return Response.json({ error: "Draft not found" }, { status: 404 });
			}
			this.broadcastTasksUpdated(projectKey);
			return Response.json({ success: true });
		} catch (error) {
			console.error("Error promoting draft:", error);
			if (isCreateLockError(error)) {
				return Response.json({ error: error.message }, { status: 409 });
			}
			return Response.json({ error: "Failed to promote draft" }, { status: 500 });
		}
	}

	private async handleListMilestones(req: Request): Promise<Response> {
		const keys = await this.resolveProjectKeys(req);
		if (keys instanceof Response) {
			return keys;
		}

		const milestones = [];
		for (const projectKey of keys) {
			try {
				const project = this.pool.resolveProject(projectKey);
				const core = await this.pool.getCore(projectKey);
				const projectMilestones = await core.filesystem.listMilestones();
				for (const milestone of projectMilestones) {
					milestones.push(this.pool.tagWithProject(project, milestone));
				}
			} catch (error) {
				console.error(`Error listing milestones for ${projectKey}:`, error);
			}
		}
		return Response.json(milestones);
	}

	private async handleListArchivedMilestones(req: Request): Promise<Response> {
		const keys = await this.resolveProjectKeys(req);
		if (keys instanceof Response) {
			return keys;
		}

		const milestones = [];
		for (const projectKey of keys) {
			try {
				const project = this.pool.resolveProject(projectKey);
				const core = await this.pool.getCore(projectKey);
				const projectMilestones = await core.filesystem.listArchivedMilestones();
				for (const milestone of projectMilestones) {
					milestones.push(this.pool.tagWithProject(project, milestone));
				}
			} catch (error) {
				console.error(`Error listing archived milestones for ${projectKey}:`, error);
			}
		}
		return Response.json(milestones);
	}

	private async handleGetMilestone(projectKey: string, milestoneId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const core = await this.pool.getCore(projectKey);
			const milestone = await core.filesystem.loadMilestone(milestoneId);
			if (!milestone) {
				return Response.json({ error: "Milestone not found" }, { status: 404 });
			}
			return Response.json(this.pool.tagWithProject(project, milestone));
		} catch (error) {
			console.error("Error loading milestone:", error);
			return Response.json({ error: "Milestone not found" }, { status: 404 });
		}
	}

	private async handleCreateMilestone(req: Request): Promise<Response> {
		const body = (await req.json()) as { projectKey?: string; title?: string; description?: string };
		const projectKey = body.projectKey?.trim() ?? "";
		if (!projectKey) {
			return Response.json({ error: "projectKey is required" }, { status: 400 });
		}

		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const title = body.title?.trim();
			if (!title) {
				return Response.json({ error: "Milestone title is required" }, { status: 400 });
			}

			const core = await this.pool.getCore(projectKey);
			const existingMilestones = await core.filesystem.listMilestones();
			const buildAliasKeys = (value: string): Set<string> => {
				const normalized = value.trim().toLowerCase();
				const keys = new Set<string>();
				if (!normalized) {
					return keys;
				}
				keys.add(normalized);
				if (/^\d+$/.test(normalized)) {
					const numeric = String(Number.parseInt(normalized, 10));
					keys.add(numeric);
					keys.add(`m-${numeric}`);
					return keys;
				}
				const match = normalized.match(/^m-(\d+)$/);
				if (match?.[1]) {
					const numeric = String(Number.parseInt(match[1], 10));
					keys.add(numeric);
					keys.add(`m-${numeric}`);
				}
				return keys;
			};
			const requestedKeys = buildAliasKeys(title);
			const duplicate = existingMilestones.find((milestone) => {
				const milestoneKeys = new Set<string>([...buildAliasKeys(milestone.id), ...buildAliasKeys(milestone.title)]);
				for (const key of requestedKeys) {
					if (milestoneKeys.has(key)) {
						return true;
					}
				}
				return false;
			});
			if (duplicate) {
				return Response.json({ error: "A milestone with this title or ID already exists" }, { status: 400 });
			}

			const milestone = await core.filesystem.createMilestone(title, body.description);
			this.broadcastTasksUpdated(projectKey);
			return Response.json(this.pool.tagWithProject(project, milestone), { status: 201 });
		} catch (error) {
			console.error("Error creating milestone:", error);
			return Response.json({ error: "Failed to create milestone" }, { status: 500 });
		}
	}

	private async handleUpdateMilestone(req: Request, projectKey: string, milestoneId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const body = await this.readOptionalJsonBody(req);
			const title = typeof body.title === "string" ? body.title.trim() : "";
			const updateTasks = typeof body.updateTasks === "boolean" ? body.updateTasks : true;

			if (!title) {
				return Response.json({ error: "Milestone title is required" }, { status: 400 });
			}

			const core = await this.pool.getCore(projectKey);
			const sourceMilestone = await core.filesystem.loadMilestone(milestoneId);
			const result = await new MilestoneHandlers(core).renameMilestone({
				from: milestoneId,
				to: title,
				updateTasks,
			});
			const milestone =
				(await core.filesystem.loadMilestone(sourceMilestone?.id ?? milestoneId)) ??
				(await core.filesystem.loadMilestone(title));
			this.broadcastTasksUpdated(projectKey);
			return Response.json({
				success: true,
				milestone: milestone ? this.pool.tagWithProject(project, milestone) : null,
				message: this.getMilestoneMutationMessage(result),
			});
		} catch (error) {
			return this.milestoneMutationErrorResponse(error, "Error updating milestone");
		}
	}

	private async handleRemoveMilestone(req: Request, projectKey: string, milestoneId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const body = await this.readOptionalJsonBody(req);
			const rawTaskHandling = body.taskHandling;
			const taskHandling =
				rawTaskHandling === undefined
					? "clear"
					: rawTaskHandling === "clear" || rawTaskHandling === "keep" || rawTaskHandling === "reassign"
						? rawTaskHandling
						: null;
			const reassignTo = typeof body.reassignTo === "string" ? body.reassignTo : undefined;

			if (!taskHandling) {
				return Response.json({ error: "taskHandling must be clear, keep, or reassign" }, { status: 400 });
			}

			const core = await this.pool.getCore(projectKey);
			const result = await new MilestoneHandlers(core).removeMilestone({
				name: milestoneId,
				taskHandling,
				reassignTo,
			});
			this.broadcastTasksUpdated(projectKey);
			return Response.json({
				success: true,
				message: this.getMilestoneMutationMessage(result),
			});
		} catch (error) {
			return this.milestoneMutationErrorResponse(error, "Error removing milestone");
		}
	}

	private async handleArchiveMilestone(projectKey: string, milestoneId: string): Promise<Response> {
		const project = this.resolveProjectFromParam(projectKey);
		if (project instanceof Response) {
			return project;
		}

		try {
			const core = await this.pool.getCore(projectKey);
			const result = await core.archiveMilestone(milestoneId);
			if (!result.success) {
				return Response.json({ error: "Milestone not found" }, { status: 404 });
			}
			this.broadcastTasksUpdated(projectKey);
			return Response.json({
				success: true,
				milestone: result.milestone ? this.pool.tagWithProject(project, result.milestone) : null,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to archive milestone";
			console.error("Error archiving milestone:", error);
			return Response.json({ error: message }, { status: 500 });
		}
	}

	private async handleGetVersion(): Promise<Response> {
		try {
			const version = await getVersion();
			return Response.json({ version });
		} catch (error) {
			console.error("Error getting version:", error);
			return Response.json({ error: "Failed to get version" }, { status: 500 });
		}
	}

	private async handleGetStatistics(req: Request): Promise<Response> {
		const keys = await this.resolveProjectKeys(req);
		if (keys instanceof Response) {
			return keys;
		}

		try {
			const perProjectStats: TaskStatistics[] = [];
			for (const projectKey of keys) {
				try {
					const project = this.pool.resolveProject(projectKey);
					const core = await this.pool.getCore(projectKey);
					const { tasks, drafts, statuses } = await core.loadAllTasksForStatistics();
					const stat = getTaskStatistics(tasks, drafts, statuses);
					stat.recentActivity.created = stat.recentActivity.created.map((task) =>
						this.pool.tagWithProject(project, task),
					);
					stat.recentActivity.updated = stat.recentActivity.updated.map((task) =>
						this.pool.tagWithProject(project, task),
					);
					stat.projectHealth.staleTasks = stat.projectHealth.staleTasks.map((task) =>
						this.pool.tagWithProject(project, task),
					);
					stat.projectHealth.blockedTasks = stat.projectHealth.blockedTasks.map((task) =>
						this.pool.tagWithProject(project, task),
					);
					perProjectStats.push(stat);
				} catch (error) {
					console.error(`Error loading statistics for ${projectKey}:`, error);
				}
			}

			const statistics = mergeTaskStatistics(perProjectStats);
			const response = {
				...statistics,
				statusCounts: Object.fromEntries(statistics.statusCounts),
				priorityCounts: Object.fromEntries(statistics.priorityCounts),
			};
			return Response.json(response);
		} catch (error) {
			console.error("Error getting statistics:", error);
			return Response.json({ error: "Failed to get statistics" }, { status: 500 });
		}
	}

	private async handleSearch(req: Request): Promise<Response> {
		const keys = await this.resolveProjectKeys(req);
		if (keys instanceof Response) {
			return keys;
		}

		try {
			const url = new URL(req.url);
			const query = url.searchParams.get("query") ?? undefined;
			const limitParam = url.searchParams.get("limit");
			const typeParams = [...url.searchParams.getAll("type"), ...url.searchParams.getAll("types")];
			const statusParams = url.searchParams.getAll("status");
			const priorityParamsRaw = url.searchParams.getAll("priority");
			const assigneeParamsRaw = [...url.searchParams.getAll("assignee"), ...url.searchParams.getAll("assignees")];
			const labelParamsRaw = [...url.searchParams.getAll("label"), ...url.searchParams.getAll("labels")];
			const modifiedFileParamsRaw = [
				...url.searchParams.getAll("modifiedFile"),
				...url.searchParams.getAll("modifiedFiles"),
			];
			const assigneesCsv = url.searchParams.get("assignees");
			if (assigneesCsv) {
				assigneeParamsRaw.push(...assigneesCsv.split(","));
			}
			const labelsCsv = url.searchParams.get("labels");
			if (labelsCsv) {
				labelParamsRaw.push(...labelsCsv.split(","));
			}
			const modifiedFilesCsv = url.searchParams.get("modifiedFiles");
			if (modifiedFilesCsv) {
				modifiedFileParamsRaw.push(...modifiedFilesCsv.split(","));
			}

			let limit: number | undefined;
			if (limitParam) {
				const parsed = Number.parseInt(limitParam, 10);
				if (Number.isNaN(parsed) || parsed <= 0) {
					return Response.json({ error: "limit must be a positive integer" }, { status: 400 });
				}
				limit = parsed;
			}

			let types: SearchResultType[] | undefined;
			if (typeParams.length > 0) {
				const allowed: SearchResultType[] = ["task", "document", "decision"];
				const normalizedTypes = typeParams
					.map((value) => value.toLowerCase())
					.filter((value): value is SearchResultType => {
						return allowed.includes(value as SearchResultType);
					});
				if (normalizedTypes.length === 0) {
					return Response.json({ error: "type must be task, document, or decision" }, { status: 400 });
				}
				types = normalizedTypes;
			}

			const filters: {
				status?: string | string[];
				priority?: SearchPriorityFilter | SearchPriorityFilter[];
				assignee?: string | string[];
				labels?: string | string[];
				modifiedFiles?: string | string[];
			} = {};

			if (statusParams.length === 1) {
				filters.status = statusParams[0];
			} else if (statusParams.length > 1) {
				filters.status = statusParams;
			}

			if (priorityParamsRaw.length > 0) {
				const allowedPriorities: SearchPriorityFilter[] = ["high", "medium", "low"];
				const normalizedPriorities = priorityParamsRaw.map((value) => value.toLowerCase());
				const invalidPriority = normalizedPriorities.find(
					(value) => !allowedPriorities.includes(value as SearchPriorityFilter),
				);
				if (invalidPriority) {
					return Response.json(
						{ error: `Unsupported priority '${invalidPriority}'. Use high, medium, or low.` },
						{ status: 400 },
					);
				}
				const casted = normalizedPriorities as SearchPriorityFilter[];
				filters.priority = casted.length === 1 ? casted[0] : casted;
			}

			if (assigneeParamsRaw.length > 0) {
				const normalizedAssignees = assigneeParamsRaw.map((value) => value.trim()).filter((value) => value.length > 0);
				if (normalizedAssignees.length > 0) {
					filters.assignee = normalizedAssignees.length === 1 ? normalizedAssignees[0] : normalizedAssignees;
				}
			}

			if (labelParamsRaw.length > 0) {
				const normalizedLabels = labelParamsRaw.map((value) => value.trim()).filter((value) => value.length > 0);
				if (normalizedLabels.length > 0) {
					filters.labels = normalizedLabels.length === 1 ? normalizedLabels[0] : normalizedLabels;
				}
			}

			if (modifiedFileParamsRaw.length > 0) {
				const normalizedModifiedFiles = modifiedFileParamsRaw
					.map((value) => value.trim())
					.filter((value) => value.length > 0);
				if (normalizedModifiedFiles.length > 0) {
					filters.modifiedFiles =
						normalizedModifiedFiles.length === 1 ? normalizedModifiedFiles[0] : normalizedModifiedFiles;
				}
			}

			const allResults = [];
			for (const projectKey of keys) {
				try {
					const project = this.pool.resolveProject(projectKey);
					await this.ensureProjectWatched(projectKey);
					const searchService = await this.pool.getSearchService(projectKey);
					const results = searchService.search({ query, types, filters });
					for (const result of results) {
						allResults.push(this.pool.tagWithProject(project, result));
					}
				} catch (error) {
					console.error(`Error searching ${projectKey}:`, error);
				}
			}

			if (limit !== undefined && allResults.length > limit) {
				return Response.json(allResults.slice(0, limit));
			}
			return Response.json(allResults);
		} catch (error) {
			console.error("Error performing global search:", error);
			return Response.json({ error: "Search failed" }, { status: 500 });
		}
	}
}
