/**
 * In-memory task search using Fuse.js
 * Used when tasks are already loaded to avoid re-fetching via ContentStore
 */

import Fuse from "fuse.js";
import type { Task } from "../types/index.ts";
import { labelsToLower } from "./label-filter.ts";
import { NO_MILESTONE_FILTER_VALUE } from "./milestone-filter.ts";
import { matchesModifiedFileFilters, normalizeModifiedFileFilters } from "./modified-files.ts";

export type LabelMatchMode = "any" | "all";

export function normalizeMultiValueFilter(value?: string | string[]): string[] | undefined {
	if (!value) {
		return undefined;
	}
	const values = Array.isArray(value) ? value : [value];
	const normalized = values.map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0);
	return normalized.length > 0 ? normalized : undefined;
}

export const normalizeStatusFilter = normalizeMultiValueFilter;

export function resolveConfiguredStatuses(values: string[], configuredStatuses: string[]): string[] {
	if (values.length === 0) {
		return [];
	}
	const canonicalByLower = new Map(configuredStatuses.map((status) => [status.toLowerCase(), status]));
	const resolved: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const canonical = canonicalByLower.get(value.toLowerCase()) ?? value;
		const key = canonical.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		resolved.push(canonical);
	}
	return resolved;
}

export interface TaskSearchOptions {
	query?: string;
	status?: string | string[];
	priority?: string | string[];
	labels?: string[];
	labelMatch?: LabelMatchMode;
	modifiedFiles?: string[];
}

export interface SharedTaskFilterOptions {
	query?: string;
	priority?: string | string[];
	labels?: string[];
	labelMatch?: LabelMatchMode;
	modifiedFiles?: string[];
	milestone?: string | string[];
	resolveMilestoneLabel?: (milestone: string) => string;
}

export interface TaskFilterOptions extends SharedTaskFilterOptions {
	status?: string | string[];
}

export interface TaskSearchIndex {
	search(options: TaskSearchOptions): Task[];
}

// Regex pattern to match any prefix (letters followed by dash)
const PREFIX_PATTERN = /^[a-zA-Z]+-/i;

/**
 * Extract prefix from an ID if present (e.g., "task-" from "task-123")
 */
function extractPrefix(id: string): string | null {
	const match = id.match(PREFIX_PATTERN);
	return match ? match[0] : null;
}

/**
 * Strip any prefix from an ID (e.g., "task-123" -> "123", "JIRA-456" -> "456")
 */
function stripPrefix(id: string): string {
	return id.replace(PREFIX_PATTERN, "");
}

function createTaskIdVariants(id: string): string[] {
	const segments = parseTaskIdSegments(id);
	const prefix = extractPrefix(id) ?? "task-"; // Default to task- if no prefix
	const lowerId = id.toLowerCase();

	if (!segments) {
		// Non-numeric ID - just return the ID and its lowercase variant
		return id === lowerId ? [id] : [id, lowerId];
	}

	const canonicalSuffix = segments.join(".");
	const variants = new Set<string>();

	// Add original ID and lowercase variant
	variants.add(id);
	variants.add(lowerId);

	// Add with extracted/default prefix
	variants.add(`${prefix}${canonicalSuffix}`);
	variants.add(`${prefix.toLowerCase()}${canonicalSuffix}`);

	// Add just the numeric part
	variants.add(canonicalSuffix);

	return Array.from(variants);
}

function parseTaskIdSegments(value: string): number[] | null {
	const withoutPrefix = stripPrefix(value);
	if (!/^[0-9]+(?:\.[0-9]+)*$/.test(withoutPrefix)) {
		return null;
	}
	return withoutPrefix.split(".").map((segment) => Number.parseInt(segment, 10));
}

interface SearchableTask {
	task: Task;
	title: string;
	bodyText: string;
	id: string;
	idVariants: string[];
	dependencyIds: string[];
	statusLower: string;
	priorityLower?: string;
	labelsLower: string[];
	modifiedFiles: string[];
}

function buildSearchableTask(task: Task): SearchableTask {
	const bodyParts: string[] = [];
	if (task.description) bodyParts.push(task.description);
	if (Array.isArray(task.acceptanceCriteriaItems) && task.acceptanceCriteriaItems.length > 0) {
		const lines = [...task.acceptanceCriteriaItems]
			.sort((a, b) => a.index - b.index)
			.map((criterion) => `- [${criterion.checked ? "x" : " "}] ${criterion.text}`);
		bodyParts.push(lines.join("\n"));
	}
	if (task.implementationPlan) bodyParts.push(task.implementationPlan);
	if (task.implementationNotes) bodyParts.push(task.implementationNotes);
	if (Array.isArray(task.comments) && task.comments.length > 0) {
		bodyParts.push(task.comments.map((comment) => comment.body).join(" "));
	}
	if (task.labels?.length) bodyParts.push(task.labels.join(" "));
	if (task.assignee?.length) bodyParts.push(task.assignee.join(" "));
	if (task.modifiedFiles?.length) bodyParts.push(task.modifiedFiles.join(" "));

	return {
		task,
		title: task.title,
		bodyText: bodyParts.join(" "),
		id: task.id,
		idVariants: createTaskIdVariants(task.id),
		dependencyIds: (task.dependencies ?? []).flatMap((dependency) => createTaskIdVariants(dependency)),
		statusLower: (task.status || "").toLowerCase(),
		priorityLower: task.priority?.toLowerCase(),
		labelsLower: (task.labels || []).map((label) => label.toLowerCase()),
		modifiedFiles: task.modifiedFiles ?? [],
	};
}

/**
 * Create an in-memory search index for tasks
 */
export function createTaskSearchIndex(tasks: Task[]): TaskSearchIndex {
	const searchableTasks = tasks.map(buildSearchableTask);

	const fuse = new Fuse(searchableTasks, {
		includeScore: true,
		threshold: 0.35,
		ignoreLocation: true,
		minMatchCharLength: 2,
		keys: [
			{ name: "title", weight: 0.35 },
			{ name: "bodyText", weight: 0.3 },
			{ name: "id", weight: 0.2 },
			{ name: "idVariants", weight: 0.1 },
			{ name: "dependencyIds", weight: 0.05 },
			{ name: "modifiedFiles", weight: 0.15 },
		],
	});

	return {
		search(options: TaskSearchOptions): Task[] {
			let results: SearchableTask[];

			// If we have a query, use Fuse for fuzzy search
			if (options.query?.trim()) {
				const fuseResults = fuse.search(options.query.trim());
				results = fuseResults.map((r) => r.item);
			} else {
				// No query - start with all tasks
				results = [...searchableTasks];
			}

			// Apply status filter (match any selected status)
			const statusFilters = normalizeStatusFilter(options.status);
			if (statusFilters && statusFilters.length > 0) {
				const allowedStatuses = new Set(statusFilters);
				results = results.filter((t) => allowedStatuses.has(t.statusLower));
			}

			// Apply priority filter (match any selected priority)
			const priorityFilters = normalizeMultiValueFilter(options.priority);
			if (priorityFilters && priorityFilters.length > 0) {
				const allowedPriorities = new Set(priorityFilters);
				results = results.filter((t) => t.priorityLower && allowedPriorities.has(t.priorityLower));
			}

			// Apply label filters. Interactive UI filters match any selected
			// label; CLI-seeded --labels filters request all-label matching.
			if (options.labels && options.labels.length > 0) {
				const required = labelsToLower(options.labels);
				const labelMatch = options.labelMatch ?? "any";
				results = results.filter((t) => {
					if (!t.labelsLower || t.labelsLower.length === 0) {
						return false;
					}
					const labelSet = new Set(t.labelsLower);
					return labelMatch === "all"
						? required.every((label) => labelSet.has(label))
						: required.some((label) => labelSet.has(label));
				});
			}

			const modifiedFiles = normalizeModifiedFileFilters(options.modifiedFiles);
			if (modifiedFiles) {
				results = results.filter((task) => matchesModifiedFileFilters(task.modifiedFiles, modifiedFiles));
			}

			return results.map((r) => r.task);
		},
	};
}

function applyMilestoneFilter(
	tasks: Task[],
	milestone: string | string[],
	resolveMilestoneLabel?: (milestone: string) => string,
): Task[] {
	const milestones = normalizeMultiValueFilter(milestone);
	if (!milestones || milestones.length === 0) {
		return tasks;
	}

	const allowedMilestones = new Set(milestones);
	const includeUnassigned = allowedMilestones.has(NO_MILESTONE_FILTER_VALUE.toLowerCase());

	return tasks.filter((task) => {
		if (!task.milestone?.trim()) {
			return includeUnassigned;
		}
		const value = resolveMilestoneLabel ? resolveMilestoneLabel(task.milestone) : task.milestone;
		return allowedMilestones.has(value.trim().toLowerCase());
	});
}

export function applyTaskFilters(tasks: Task[], options: TaskFilterOptions, index?: TaskSearchIndex): Task[] {
	const query = options.query?.trim() ?? "";
	const statusFilters = normalizeMultiValueFilter(options.status);
	const priorityFilters = normalizeMultiValueFilter(options.priority);
	const hasBaseFilters = Boolean(
		query ||
			(statusFilters && statusFilters.length > 0) ||
			(priorityFilters && priorityFilters.length > 0) ||
			(options.labels && options.labels.length > 0) ||
			(options.modifiedFiles && options.modifiedFiles.length > 0),
	);

	let results = hasBaseFilters
		? (index ?? createTaskSearchIndex(tasks)).search({
				query,
				status: options.status,
				priority: options.priority,
				labels: options.labels,
				labelMatch: options.labelMatch,
				modifiedFiles: options.modifiedFiles,
			})
		: [...tasks];

	if (options.milestone) {
		results = applyMilestoneFilter(results, options.milestone, options.resolveMilestoneLabel);
	}

	return results;
}

export function applySharedTaskFilters(
	tasks: Task[],
	options: SharedTaskFilterOptions,
	index?: TaskSearchIndex,
): Task[] {
	return applyTaskFilters(
		tasks,
		{
			query: options.query,
			priority: options.priority,
			labels: options.labels,
			labelMatch: options.labelMatch,
			modifiedFiles: options.modifiedFiles,
			milestone: options.milestone,
			resolveMilestoneLabel: options.resolveMilestoneLabel,
		},
		index,
	);
}
