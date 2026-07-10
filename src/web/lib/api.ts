import type { TaskStatistics } from "../../core/statistics.ts";
import type {
	BacklogConfig,
	Decision,
	Document,
	Milestone,
	ProjectRef,
	SearchPriorityFilter,
	SearchResult,
	SearchResultType,
	Task,
	TaskStatus,
} from "../../types/index.ts";
import type { DuplicateGroup } from "../../utils/duplicate-detection.ts";

const API_BASE = "/api";

export type GlobalTask = Task & ProjectRef;
export type GlobalMilestone = Milestone & ProjectRef;
export type GlobalDocument = Document & ProjectRef;
export type GlobalDecision = Decision & ProjectRef;

export interface ProjectStatusSummary {
	key: string;
	name: string;
	path: string;
	healthy: boolean;
	error?: string;
	lastSeen?: string;
}

export interface GlobalInitializationStatus {
	mode: "global";
	initialized: true;
	projects: ProjectStatusSummary[];
}

export type ServerStatus = InitializationStatus | GlobalInitializationStatus;

export function isGlobalStatus(status: ServerStatus): status is GlobalInitializationStatus {
	return "mode" in status && status.mode === "global";
}

export function taskProjectKey(entity: { projectKey?: string }): string | undefined {
	return entity.projectKey;
}

export interface ReorderTaskPayload {
	taskId: string;
	targetStatus: string;
	orderedTaskIds: string[];
	targetMilestone?: string | null;
}

export type TaskUpdateRequest = Omit<Partial<Task>, "milestone"> & {
	milestone?: string | null;
	commentsAppend?: string[];
	commentAuthor?: string;
};

export interface InitializationStatus {
	initialized: boolean;
	projectPath: string;
	backlogDirectory?: string | null;
	backlogDirectorySource?: "backlog" | ".backlog" | "custom" | null;
	configLocation?: "folder" | "root" | null;
	rootConfigPath?: string | null;
}

// Enhanced error types for better error handling
export class ApiError extends Error {
	constructor(
		message: string,
		public status?: number,
		public code?: string,
		public data?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}

	static fromResponse(response: Response, data?: unknown): ApiError {
		const errorMessage =
			typeof data === "object" && data !== null && "error" in data ? (data as { error?: unknown }).error : undefined;
		const message =
			typeof errorMessage === "string" && errorMessage.trim().length > 0
				? errorMessage
				: `HTTP ${response.status}: ${response.statusText}`;
		return new ApiError(message, response.status, response.statusText, data);
	}
}

export class NetworkError extends Error {
	constructor(message = "Network request failed") {
		super(message);
		this.name = "NetworkError";
	}
}

// Request configuration interface
interface RequestConfig {
	retries?: number;
	timeout?: number;
	Headers?: Record<string, string>;
}

// Default configuration
const DEFAULT_CONFIG: RequestConfig = {
	retries: 3,
	timeout: 10000,
};

export class ApiClient {
	private config: RequestConfig;
	private serverMode: "project" | "global" = "project";
	private selectedProjectKeys: string[] = [];

	constructor(config: RequestConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	setServerMode(mode: "project" | "global"): void {
		this.serverMode = mode;
	}

	getServerMode(): "project" | "global" {
		return this.serverMode;
	}

	setSelectedProjectKeys(keys: string[]): void {
		this.selectedProjectKeys = keys;
	}

	getSelectedProjectKeys(): string[] {
		return [...this.selectedProjectKeys];
	}

	private isGlobalMode(): boolean {
		return this.serverMode === "global";
	}

	private apiRoot(): string {
		return this.isGlobalMode() ? `${API_BASE}/global` : API_BASE;
	}

	private appendProjectsParam(params: URLSearchParams): void {
		if (this.isGlobalMode() && this.selectedProjectKeys.length > 0) {
			params.set("projects", this.selectedProjectKeys.join(","));
		}
	}

	private requireProjectKey(projectKey?: string): string {
		if (!this.isGlobalMode()) {
			return "";
		}
		if (!projectKey) {
			throw new Error("projectKey is required in global mode");
		}
		return projectKey;
	}

	// Enhanced fetch with retry logic and better error handling
	private async fetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
		const { retries = 3, timeout = 10000 } = this.config;
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				// Add timeout to the request
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeout);

				const response = await fetch(url, {
					...options,
					signal: controller.signal,
					headers: {
						"Content-Type": "application/json",
						...options.headers,
					},
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					let errorData: unknown = null;
					try {
						errorData = await response.json();
					} catch {
						// Ignore JSON parse errors for error data
					}
					throw ApiError.fromResponse(response, errorData);
				}

				return response;
			} catch (error) {
				lastError = error as Error;

				// Don't retry on client errors (4xx) or specific cases
				if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) {
					throw error;
				}

				// For network errors or server errors, retry with exponential backoff
				if (attempt < retries) {
					const delay = Math.min(1000 * 2 ** attempt, 10000);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}

		// If we get here, all retries failed
		if (lastError instanceof ApiError) {
			throw lastError;
		}
		throw new NetworkError(`Request failed after ${retries + 1} attempts: ${lastError?.message}`);
	}

	// Helper method for JSON responses
	private async fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
		const response = await this.fetchWithRetry(url, options);
		return response.json();
	}
	async fetchTasks(options?: {
		status?: string;
		assignee?: string;
		parent?: string;
		priority?: SearchPriorityFilter;
		labels?: string[];
		crossBranch?: boolean;
	}): Promise<Task[]> {
		const params = new URLSearchParams();
		if (options?.status) params.append("status", options.status);
		if (options?.assignee) params.append("assignee", options.assignee);
		if (options?.parent) params.append("parent", options.parent);
		if (options?.priority) params.append("priority", options.priority);
		if (options?.labels) {
			for (const label of options.labels) {
				if (label && label.trim().length > 0) {
					params.append("label", label.trim());
				}
			}
		}
		if (options?.crossBranch !== false) params.append("crossBranch", "true");
		this.appendProjectsParam(params);

		const url = `${this.apiRoot()}/tasks${params.toString() ? `?${params.toString()}` : ""}`;
		return this.fetchJson<Task[]>(url);
	}

	async search(
		options: {
			query?: string;
			types?: SearchResultType[];
			status?: string | string[];
			priority?: SearchPriorityFilter | SearchPriorityFilter[];
			assignee?: string | string[];
			labels?: string[];
			modifiedFiles?: string[];
			limit?: number;
		} = {},
	): Promise<SearchResult[]> {
		const params = new URLSearchParams();
		if (options.query) {
			params.set("query", options.query);
		}
		if (options.types && options.types.length > 0) {
			for (const type of options.types) {
				params.append("type", type);
			}
		}
		if (options.status) {
			const statuses = Array.isArray(options.status) ? options.status : [options.status];
			for (const status of statuses) {
				params.append("status", status);
			}
		}
		if (options.priority) {
			const priorities = Array.isArray(options.priority) ? options.priority : [options.priority];
			for (const priority of priorities) {
				params.append("priority", priority);
			}
		}
		if (options.assignee) {
			const assignees = Array.isArray(options.assignee) ? options.assignee : [options.assignee];
			for (const assignee of assignees) {
				if (assignee && assignee.trim().length > 0) {
					params.append("assignee", assignee.trim());
				}
			}
		}
		if (options.labels) {
			for (const label of options.labels) {
				if (label && label.trim().length > 0) {
					params.append("label", label.trim());
				}
			}
		}
		if (options.modifiedFiles) {
			for (const file of options.modifiedFiles) {
				if (file && file.trim().length > 0) {
					params.append("modifiedFile", file.trim());
				}
			}
		}
		if (options.limit !== undefined) {
			params.set("limit", String(options.limit));
		}
		this.appendProjectsParam(params);

		const url = `${this.apiRoot()}/search${params.toString() ? `?${params.toString()}` : ""}`;
		return this.fetchJson<SearchResult[]>(url);
	}

	async fetchTask(id: string, projectKey?: string): Promise<Task> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/tasks/${key}/${encodeURIComponent(id)}`
			: `${API_BASE}/task/${encodeURIComponent(id)}`;
		return this.fetchJson<Task>(url);
	}

	async createTask(task: Omit<Task, "id" | "createdDate"> & Partial<ProjectRef>, projectKey?: string): Promise<Task> {
		const key = this.requireProjectKey(projectKey ?? task.projectKey);
		const url = this.isGlobalMode() ? `${API_BASE}/global/tasks` : `${API_BASE}/tasks`;
		return this.fetchJson<Task>(url, {
			method: "POST",
			body: JSON.stringify(this.isGlobalMode() ? { ...task, projectKey: key } : task),
		});
	}

	async updateTask(id: string, updates: TaskUpdateRequest, projectKey?: string): Promise<Task> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/tasks/${key}/${encodeURIComponent(id)}`
			: `${API_BASE}/tasks/${encodeURIComponent(id)}`;
		return this.fetchJson<Task>(url, {
			method: "PUT",
			body: JSON.stringify(updates),
		});
	}

	async reorderTask(
		payload: ReorderTaskPayload & Partial<ProjectRef>,
		projectKey?: string,
	): Promise<{ success: boolean; task: Task }> {
		const key = this.requireProjectKey(projectKey ?? payload.projectKey);
		const url = this.isGlobalMode() ? `${API_BASE}/global/tasks/reorder` : `${API_BASE}/tasks/reorder`;
		return this.fetchJson<{ success: boolean; task: Task }>(url, {
			method: "POST",
			body: JSON.stringify(this.isGlobalMode() ? { ...payload, projectKey: key } : payload),
		});
	}

	async archiveTask(id: string, projectKey?: string): Promise<void> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/tasks/${key}/${encodeURIComponent(id)}`
			: `${API_BASE}/tasks/${encodeURIComponent(id)}`;
		await this.fetchWithRetry(url, {
			method: "DELETE",
		});
	}

	async completeTask(id: string, projectKey?: string): Promise<void> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/tasks/${key}/${encodeURIComponent(id)}/complete`
			: `${API_BASE}/tasks/${encodeURIComponent(id)}/complete`;
		await this.fetchWithRetry(url, {
			method: "POST",
		});
	}

	async getCleanupPreview(age: number): Promise<{
		count: number;
		tasks: Array<{ id: string; title: string; updatedDate?: string; createdDate: string }>;
		milestoneCount: number;
		milestones: Array<{ id: string; title: string; completedAt: string; taskCount: number }>;
	}> {
		return this.fetchJson<{
			count: number;
			tasks: Array<{ id: string; title: string; updatedDate?: string; createdDate: string }>;
			milestoneCount: number;
			milestones: Array<{ id: string; title: string; completedAt: string; taskCount: number }>;
		}>(`${API_BASE}/tasks/cleanup?age=${age}`);
	}

	async executeCleanup(age: number): Promise<{
		success: boolean;
		movedCount: number;
		totalCount: number;
		message: string;
		failedTasks?: string[];
		archivedMilestoneCount?: number;
		failedMilestones?: string[];
	}> {
		return this.fetchJson<{
			success: boolean;
			movedCount: number;
			totalCount: number;
			message: string;
			failedTasks?: string[];
			archivedMilestoneCount?: number;
			failedMilestones?: string[];
		}>(`${API_BASE}/tasks/cleanup/execute`, {
			method: "POST",
			body: JSON.stringify({ age }),
		});
	}

	async updateTaskStatus(id: string, status: TaskStatus, projectKey?: string): Promise<Task> {
		return this.updateTask(id, { status }, projectKey);
	}

	async fetchDuplicateTasks(): Promise<DuplicateGroup[]> {
		try {
			return await this.fetchJson<DuplicateGroup[]>(`${API_BASE}/tasks/duplicates`);
		} catch {
			return [];
		}
	}

	async fetchStatuses(): Promise<string[]> {
		const params = new URLSearchParams();
		this.appendProjectsParam(params);
		const url = `${this.apiRoot()}/statuses${params.toString() ? `?${params.toString()}` : ""}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error("Failed to fetch statuses");
		}
		return response.json();
	}

	async fetchConfig(): Promise<BacklogConfig> {
		if (this.isGlobalMode()) {
			const response = await fetch(`${API_BASE}/global/config`);
			if (!response.ok) {
				throw new Error("Failed to fetch global config");
			}
			const globalConfig = await response.json();
			return {
				projectName: "Global Dashboard",
				statuses: await this.fetchStatuses(),
				labels: [],
				defaultAssignee: [],
				...globalConfig,
			} as BacklogConfig;
		}
		const response = await fetch(`${API_BASE}/config`);
		if (!response.ok) {
			throw new Error("Failed to fetch config");
		}
		return response.json();
	}

	async updateConfig(config: BacklogConfig): Promise<BacklogConfig> {
		if (this.isGlobalMode()) {
			throw new Error("Global dashboard settings are read-only in the web UI");
		}
		const response = await fetch(`${API_BASE}/config`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(config),
		});
		if (!response.ok) {
			throw new Error("Failed to update config");
		}
		return response.json();
	}

	async fetchDocs(): Promise<Document[]> {
		const params = new URLSearchParams();
		this.appendProjectsParam(params);
		const url = `${this.apiRoot()}/docs${params.toString() ? `?${params.toString()}` : ""}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error("Failed to fetch documentation");
		}
		return response.json();
	}

	async fetchDoc(filename: string, projectKey?: string): Promise<Document> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/docs/${key}/${encodeURIComponent(filename)}`
			: `${API_BASE}/docs/${encodeURIComponent(filename)}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error("Failed to fetch document");
		}
		return response.json();
	}

	async fetchDocument(id: string, projectKey?: string): Promise<Document> {
		return this.fetchDoc(id, projectKey);
	}

	async updateDoc(
		filename: string,
		content: string,
		title?: string,
		path?: string | null,
		projectKey?: string,
	): Promise<Document> {
		const key = this.requireProjectKey(projectKey);
		const payload: Record<string, unknown> = { content };
		if (typeof title === "string") {
			payload.title = title;
		}
		if (path !== undefined) {
			payload.path = path;
		}

		const url = this.isGlobalMode()
			? `${API_BASE}/global/docs/${key}/${encodeURIComponent(filename)}`
			: `${API_BASE}/docs/${encodeURIComponent(filename)}`;
		const response = await fetch(url, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		if (!response.ok) {
			throw new Error("Failed to update document");
		}
		return response.json();
	}

	async createDoc(
		filename: string,
		content: string,
		path?: string,
		projectKey?: string,
	): Promise<Document & { success?: boolean }> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode() ? `${API_BASE}/global/docs/${key}` : `${API_BASE}/docs`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ filename, content, path }),
		});
		if (!response.ok) {
			throw new Error("Failed to create document");
		}
		return response.json();
	}

	async fetchDecisions(): Promise<Decision[]> {
		const params = new URLSearchParams();
		this.appendProjectsParam(params);
		const url = `${this.apiRoot()}/decisions${params.toString() ? `?${params.toString()}` : ""}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error("Failed to fetch decisions");
		}
		return response.json();
	}

	async fetchDecision(id: string, projectKey?: string): Promise<Decision> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/decisions/${key}/${encodeURIComponent(id)}`
			: `${API_BASE}/decisions/${encodeURIComponent(id)}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error("Failed to fetch decision");
		}
		return response.json();
	}

	async fetchDecisionData(id: string, projectKey?: string): Promise<Decision> {
		if (this.isGlobalMode()) {
			return this.fetchDecision(id, projectKey);
		}
		const response = await fetch(`${API_BASE}/decision/${encodeURIComponent(id)}`);
		if (!response.ok) {
			throw new Error("Failed to fetch decision");
		}
		return response.json();
	}

	async updateDecision(id: string, content: string, projectKey?: string): Promise<void> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/decisions/${key}/${encodeURIComponent(id)}`
			: `${API_BASE}/decisions/${encodeURIComponent(id)}`;
		const response = await fetch(url, {
			method: "PUT",
			headers: {
				"Content-Type": "text/plain",
			},
			body: content,
		});
		if (!response.ok) {
			throw new Error("Failed to update decision");
		}
	}

	async createDecision(title: string, projectKey?: string): Promise<Decision> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode() ? `${API_BASE}/global/decisions/${key}` : `${API_BASE}/decisions`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title }),
		});
		if (!response.ok) {
			throw new Error("Failed to create decision");
		}
		return response.json();
	}

	async fetchMilestones(): Promise<Milestone[]> {
		const params = new URLSearchParams();
		this.appendProjectsParam(params);
		const url = `${this.apiRoot()}/milestones${params.toString() ? `?${params.toString()}` : ""}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error("Failed to fetch milestones");
		}
		return response.json();
	}

	async fetchArchivedMilestones(): Promise<Milestone[]> {
		const params = new URLSearchParams();
		this.appendProjectsParam(params);
		const url = `${this.apiRoot()}/milestones/archived${params.toString() ? `?${params.toString()}` : ""}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error("Failed to fetch archived milestones");
		}
		return response.json();
	}

	async fetchMilestone(id: string, projectKey?: string): Promise<Milestone> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/milestones/${key}/${encodeURIComponent(id)}`
			: `${API_BASE}/milestones/${encodeURIComponent(id)}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error("Failed to fetch milestone");
		}
		return response.json();
	}

	async createMilestone(title: string, description?: string, projectKey?: string): Promise<Milestone> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode() ? `${API_BASE}/global/milestones` : `${API_BASE}/milestones`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(this.isGlobalMode() ? { title, description, projectKey: key } : { title, description }),
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Failed to create milestone");
		}
		return response.json();
	}

	async updateMilestone(
		id: string,
		title: string,
		projectKey?: string,
	): Promise<{ success: boolean; milestone?: Milestone | null; message?: string }> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/milestones/${key}/${encodeURIComponent(id)}`
			: `${API_BASE}/milestones/${encodeURIComponent(id)}`;
		const response = await fetch(url, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title }),
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Failed to update milestone");
		}
		return response.json();
	}

	async removeMilestone(
		id: string,
		options: { taskHandling?: "clear" | "keep" | "reassign"; reassignTo?: string } = {},
		projectKey?: string,
	): Promise<{ success: boolean; message?: string }> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/milestones/${key}/${encodeURIComponent(id)}`
			: `${API_BASE}/milestones/${encodeURIComponent(id)}`;
		const response = await fetch(url, {
			method: "DELETE",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(options),
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Failed to remove milestone");
		}
		return response.json();
	}

	async archiveMilestone(id: string, projectKey?: string): Promise<{ success: boolean; milestone?: Milestone | null }> {
		const key = this.requireProjectKey(projectKey);
		const url = this.isGlobalMode()
			? `${API_BASE}/global/milestones/${key}/${encodeURIComponent(id)}/archive`
			: `${API_BASE}/milestones/${encodeURIComponent(id)}/archive`;
		const response = await fetch(url, {
			method: "POST",
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Failed to archive milestone");
		}
		return response.json();
	}

	async fetchStatistics(): Promise<
		TaskStatistics & { statusCounts: Record<string, number>; priorityCounts: Record<string, number> }
	> {
		const params = new URLSearchParams();
		this.appendProjectsParam(params);
		const url = `${this.apiRoot()}/statistics${params.toString() ? `?${params.toString()}` : ""}`;
		return this.fetchJson<
			TaskStatistics & { statusCounts: Record<string, number>; priorityCounts: Record<string, number> }
		>(url);
	}

	async checkStatus(): Promise<ServerStatus> {
		const status = await this.fetchJson<ServerStatus>(`${API_BASE}/status`);
		if (isGlobalStatus(status)) {
			this.serverMode = "global";
		} else {
			this.serverMode = "project";
		}
		return status;
	}

	async fetchProjects(): Promise<ProjectStatusSummary[]> {
		return this.fetchJson<ProjectStatusSummary[]>(`${API_BASE}/global/projects`);
	}

	async initializeProject(options: {
		projectName: string;
		backlogDirectory?: string;
		backlogDirectorySource?: "backlog" | ".backlog" | "custom";
		configLocation?: "folder" | "root";
		integrationMode: "mcp" | "cli" | "none";
		mcpClients?: ("claude" | "codex" | "gemini" | "kiro" | "guide")[];
		agentInstructions?: ("CLAUDE.md" | "AGENTS.md" | "GEMINI.md" | ".github/copilot-instructions.md")[];
		installClaudeAgent?: boolean;
		filesystemOnly?: boolean;
		advancedConfig?: {
			checkActiveBranches?: boolean;
			remoteOperations?: boolean;
			activeBranchDays?: number;
			bypassGitHooks?: boolean;
			autoCommit?: boolean;
			zeroPaddedIds?: number;
			taskPrefix?: string;
			defaultEditor?: string;
			defaultPort?: number;
			autoOpenBrowser?: boolean;
		};
	}): Promise<{ success: boolean; projectName: string; mcpResults?: Record<string, string> }> {
		return this.fetchJson<{ success: boolean; projectName: string; mcpResults?: Record<string, string> }>(
			`${API_BASE}/init`,
			{
				method: "POST",
				body: JSON.stringify(options),
			},
		);
	}
}

export const apiClient = new ApiClient();
