import { Core } from "../core/backlog.ts";
import type { ContentStore } from "../core/content-store.ts";
import type { SearchService } from "../core/search-service.ts";
import { type GlobalConfig, getProjectByKey, loadGlobalConfig, type RegisteredProject } from "../global/registry.ts";
import type { ProjectRef } from "../types/index.ts";

export interface ProjectSummary extends RegisteredProject {
	healthy: boolean;
	error?: string;
}

export type WithProjectRef<T> = T & ProjectRef;

export class GlobalProjectPool {
	private cores = new Map<string, Core>();
	private contentStores = new Map<string, ContentStore>();
	private searchServices = new Map<string, SearchService>();
	private config: GlobalConfig | null = null;

	async reloadConfig(): Promise<GlobalConfig> {
		this.config = await loadGlobalConfig();
		return this.config;
	}

	async getConfig(): Promise<GlobalConfig> {
		return this.config ?? this.reloadConfig();
	}

	async listProjectSummaries(): Promise<ProjectSummary[]> {
		const config = await this.getConfig();
		const summaries: ProjectSummary[] = [];
		for (const project of config.projects) {
			try {
				await this.getCore(project.key);
				summaries.push({ ...project, healthy: true });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				summaries.push({ ...project, healthy: false, error: message });
			}
		}
		return summaries;
	}

	resolveProject(projectKey: string): RegisteredProject {
		const config = this.config;
		if (!config) {
			throw new Error("Global config not loaded");
		}
		const project = getProjectByKey(config, projectKey);
		if (!project) {
			throw new Error(`Unknown project: ${projectKey}`);
		}
		return project;
	}

	async getCore(projectKey: string): Promise<Core> {
		const existing = this.cores.get(projectKey);
		if (existing) {
			return existing;
		}
		const project = this.resolveProject(projectKey);
		const core = new Core(project.path, { enableWatchers: true });
		this.cores.set(projectKey, core);
		return core;
	}

	async getContentStore(projectKey: string): Promise<ContentStore> {
		const existing = this.contentStores.get(projectKey);
		if (existing) {
			return existing;
		}
		const core = await this.getCore(projectKey);
		const store = await core.getContentStore();
		this.contentStores.set(projectKey, store);
		return store;
	}

	async getSearchService(projectKey: string): Promise<SearchService> {
		const existing = this.searchServices.get(projectKey);
		if (existing) {
			return existing;
		}
		const core = await this.getCore(projectKey);
		const search = await core.getSearchService();
		this.searchServices.set(projectKey, search);
		return search;
	}

	tagWithProject<T>(project: RegisteredProject, value: T): WithProjectRef<T> {
		return {
			...value,
			projectKey: project.key,
			projectName: project.name,
			projectPath: project.path,
		};
	}

	parseProjectKeysParam(projectsParam: string | null, config: GlobalConfig): string[] {
		if (!projectsParam || projectsParam.trim() === "") {
			return config.projects.map((p) => p.key);
		}
		return projectsParam
			.split(",")
			.map((key) => key.trim())
			.filter(Boolean);
	}

	async dispose(): Promise<void> {
		for (const core of this.cores.values()) {
			core.disposeSearchService();
			core.disposeContentStore();
		}
		this.cores.clear();
		this.contentStores.clear();
		this.searchServices.clear();
	}
}
