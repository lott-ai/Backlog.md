import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient, type ProjectStatusSummary } from "../lib/api";

interface ProjectFilterContextValue {
	isGlobalMode: boolean;
	projects: ProjectStatusSummary[];
	selectedProjectKeys: string[];
	setSelectedProjectKeys: (keys: string[]) => void;
	toggleProject: (key: string) => void;
	filterByProject: <T extends { projectKey?: string }>(items: T[]) => T[];
}

const ProjectFilterContext = createContext<ProjectFilterContextValue | null>(null);

const STORAGE_KEY = "backlog.global.selectedProjects";

export function ProjectFilterProvider({
	isGlobalMode,
	children,
}: {
	isGlobalMode: boolean;
	children: ReactNode;
}) {
	const [projects, setProjects] = useState<ProjectStatusSummary[]>([]);
	const [selectedProjectKeys, setSelectedProjectKeysState] = useState<string[]>(() => {
		if (!isGlobalMode || typeof window === "undefined") {
			return [];
		}
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
		} catch {
			return [];
		}
	});

	const setSelectedProjectKeys = useCallback((keys: string[]) => {
		setSelectedProjectKeysState(keys);
		apiClient.setSelectedProjectKeys(keys);
		if (typeof window !== "undefined") {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
		}
	}, []);

	useEffect(() => {
		apiClient.setSelectedProjectKeys(selectedProjectKeys);
	}, [selectedProjectKeys]);

	useEffect(() => {
		if (!isGlobalMode) {
			return;
		}
		void apiClient.fetchProjects().then(setProjects).catch(() => setProjects([]));
	}, [isGlobalMode]);

	const toggleProject = useCallback(
		(key: string) => {
			const healthyKeys = projects.filter((p) => p.healthy).map((p) => p.key);
			if (selectedProjectKeys.length === 0) {
				setSelectedProjectKeys(healthyKeys.filter((k) => k !== key));
				return;
			}
			if (selectedProjectKeys.includes(key)) {
				const next = selectedProjectKeys.filter((k) => k !== key);
				setSelectedProjectKeys(next.length === 0 ? [] : next);
			} else {
				const next = [...selectedProjectKeys, key];
				setSelectedProjectKeys(next.length === healthyKeys.length ? [] : next);
			}
		},
		[projects, selectedProjectKeys, setSelectedProjectKeys],
	);

	const filterByProject = useCallback(
		<T extends { projectKey?: string }>(items: T[]): T[] => {
			if (!isGlobalMode || selectedProjectKeys.length === 0) {
				return items;
			}
			const selected = new Set(selectedProjectKeys);
			return items.filter((item) => item.projectKey && selected.has(item.projectKey));
		},
		[isGlobalMode, selectedProjectKeys],
	);

	const value = useMemo(
		() => ({
			isGlobalMode,
			projects,
			selectedProjectKeys,
			setSelectedProjectKeys,
			toggleProject,
			filterByProject,
		}),
		[isGlobalMode, projects, selectedProjectKeys, setSelectedProjectKeys, toggleProject, filterByProject],
	);

	return <ProjectFilterContext.Provider value={value}>{children}</ProjectFilterContext.Provider>;
}

export function useProjectFilter(): ProjectFilterContextValue {
	const context = useContext(ProjectFilterContext);
	if (!context) {
		return {
			isGlobalMode: false,
			projects: [],
			selectedProjectKeys: [],
			setSelectedProjectKeys: () => { },
			toggleProject: () => { },
			filterByProject: <T extends { projectKey?: string }>(items: T[]) => items,
		};
	}
	return context;
}
