import type { Milestone, MilestoneBucket, MilestoneSummary, Task } from "../types/index.ts";
import { isTerminalStatus } from "../utils/terminal-status.ts";

const NO_MILESTONE_KEY = "__none";

export interface CompletedMilestoneCandidate {
	milestone: Milestone;
	completedAt: string;
	taskCount: number;
	tasks: Task[];
}

/**
 * Normalize a milestone name/ID by trimming whitespace
 */
export function normalizeMilestoneName(name: string): string {
	return name.trim();
}

/**
 * Get a lowercase key for milestone comparison
 */
export function milestoneKey(name?: string | null): string {
	return normalizeMilestoneName(name ?? "").toLowerCase();
}

/**
 * Collect archived milestone keys, excluding archived titles that are reused by active milestones.
 */
export function collectArchivedMilestoneKeys(archivedMilestones: Milestone[], activeMilestones: Milestone[]): string[] {
	const keys = new Set<string>();
	const activeTitleKeys = new Set(activeMilestones.map((milestone) => milestoneKey(milestone.title)).filter(Boolean));

	for (const milestone of archivedMilestones) {
		const idKey = milestoneKey(milestone.id);
		if (idKey) {
			keys.add(idKey);
		}
		const titleKey = milestoneKey(milestone.title);
		if (titleKey && !activeTitleKeys.has(titleKey)) {
			keys.add(titleKey);
		}
	}

	return Array.from(keys);
}

/**
 * Validate a milestone name for creation
 */
export function validateMilestoneName(name: string, existingMilestones: string[]): string | null {
	const normalizedName = normalizeMilestoneName(name);
	if (!normalizedName) {
		return "Milestone name cannot be empty.";
	}

	const normalizedExisting = existingMilestones.map((milestone) => milestoneKey(milestone)).filter(Boolean);

	if (normalizedExisting.includes(milestoneKey(normalizedName))) {
		return "Milestone already exists.";
	}

	return null;
}

function buildMilestoneAliasMap(
	milestoneEntities: Milestone[],
	archivedMilestones: Milestone[] = [],
): Map<string, string> {
	const aliasMap = new Map<string, string>();
	const collectIdAliasKeys = (value: string): string[] => {
		const idKey = milestoneKey(value);
		if (!idKey) return [];
		const keys = new Set<string>([idKey]);
		if (/^\d+$/.test(value.trim())) {
			const numericAlias = String(Number.parseInt(value.trim(), 10));
			keys.add(numericAlias);
			keys.add(`m-${numericAlias}`);
			return Array.from(keys);
		}
		const idMatch = value.trim().match(/^m-(\d+)$/i);
		if (idMatch?.[1]) {
			const numericAlias = String(Number.parseInt(idMatch[1], 10));
			keys.add(`m-${numericAlias}`);
			keys.add(numericAlias);
		}
		return Array.from(keys);
	};
	const reservedIdKeys = new Set<string>();
	for (const milestone of [...milestoneEntities, ...archivedMilestones]) {
		for (const key of collectIdAliasKeys(milestone.id)) {
			reservedIdKeys.add(key);
		}
	}
	const setAlias = (aliasKey: string, normalizedId: string, allowOverwrite: boolean): void => {
		const existing = aliasMap.get(aliasKey);
		if (!existing) {
			aliasMap.set(aliasKey, normalizedId);
			return;
		}
		if (!allowOverwrite) {
			return;
		}
		const existingKey = existing.toLowerCase();
		const nextKey = normalizedId.toLowerCase();
		const preferredRawId = /^\d+$/.test(aliasKey) ? `m-${aliasKey}` : /^m-\d+$/.test(aliasKey) ? aliasKey : null;
		if (preferredRawId) {
			const existingIsPreferred = existingKey === preferredRawId;
			const nextIsPreferred = nextKey === preferredRawId;
			if (existingIsPreferred && !nextIsPreferred) {
				return;
			}
			if (nextIsPreferred && !existingIsPreferred) {
				aliasMap.set(aliasKey, normalizedId);
			}
			return;
		}
		aliasMap.set(aliasKey, normalizedId);
	};
	const addIdAliases = (normalizedId: string, options?: { allowOverwrite?: boolean }) => {
		const allowOverwrite = options?.allowOverwrite ?? true;
		const idKey = milestoneKey(normalizedId);
		if (idKey) {
			setAlias(idKey, normalizedId, allowOverwrite);
		}
		const idMatch = normalizedId.match(/^m-(\d+)$/i);
		if (!idMatch?.[1]) {
			return;
		}
		const numericAlias = String(Number.parseInt(idMatch[1], 10));
		const canonicalId = `m-${numericAlias}`;
		if (canonicalId) {
			setAlias(canonicalId, normalizedId, allowOverwrite);
		}
		if (numericAlias) {
			setAlias(numericAlias, normalizedId, allowOverwrite);
		}
	};
	const activeTitleCounts = new Map<string, number>();
	for (const milestone of milestoneEntities) {
		const titleKey = milestoneKey(milestone.title);
		if (!titleKey) continue;
		activeTitleCounts.set(titleKey, (activeTitleCounts.get(titleKey) ?? 0) + 1);
	}
	const activeTitleKeys = new Set(activeTitleCounts.keys());

	for (const milestone of milestoneEntities) {
		const normalizedId = normalizeMilestoneName(milestone.id);
		const normalizedTitle = normalizeMilestoneName(milestone.title);
		if (!normalizedId) continue;
		addIdAliases(normalizedId);
		const titleKey = milestoneKey(normalizedTitle);
		if (titleKey && !reservedIdKeys.has(titleKey) && activeTitleCounts.get(titleKey) === 1) {
			if (!aliasMap.has(titleKey)) {
				aliasMap.set(titleKey, normalizedId);
			}
		}
	}

	const archivedTitleCounts = new Map<string, number>();
	for (const milestone of archivedMilestones) {
		const titleKey = milestoneKey(milestone.title);
		if (!titleKey || activeTitleKeys.has(titleKey)) continue;
		archivedTitleCounts.set(titleKey, (archivedTitleCounts.get(titleKey) ?? 0) + 1);
	}

	for (const milestone of archivedMilestones) {
		const normalizedId = normalizeMilestoneName(milestone.id);
		const normalizedTitle = normalizeMilestoneName(milestone.title);
		if (!normalizedId) continue;
		addIdAliases(normalizedId, { allowOverwrite: false });
		const titleKey = milestoneKey(normalizedTitle);
		if (!titleKey || activeTitleKeys.has(titleKey) || reservedIdKeys.has(titleKey)) continue;
		if (archivedTitleCounts.get(titleKey) === 1) {
			if (!aliasMap.has(titleKey)) {
				aliasMap.set(titleKey, normalizedId);
			}
		}
	}

	return aliasMap;
}

function canonicalizeMilestoneValue(value: string | null | undefined, aliasMap: Map<string, string>): string {
	const normalized = normalizeMilestoneName(value ?? "");
	if (!normalized) return "";
	const normalizedKey = milestoneKey(normalized);
	const direct = aliasMap.get(normalizedKey);
	if (direct) {
		return direct;
	}
	const idMatch = normalized.match(/^m-(\d+)$/i);
	if (idMatch?.[1]) {
		const numericAlias = String(Number.parseInt(idMatch[1], 10));
		return aliasMap.get(`m-${numericAlias}`) ?? aliasMap.get(numericAlias) ?? normalized;
	}
	if (/^\d+$/.test(normalized)) {
		const numericAlias = String(Number.parseInt(normalized, 10));
		return aliasMap.get(`m-${numericAlias}`) ?? aliasMap.get(numericAlias) ?? normalized;
	}
	return normalized;
}

function canonicalizeTaskMilestones(
	tasks: Task[],
	milestoneEntities: Milestone[],
	archivedMilestones: Milestone[] = [],
): Task[] {
	const aliasMap = buildMilestoneAliasMap(milestoneEntities, archivedMilestones);
	return tasks.map((task) => {
		const canonicalMilestone = canonicalizeMilestoneValue(task.milestone, aliasMap);
		if (task.milestone === canonicalMilestone) {
			return task;
		}
		return {
			...task,
			milestone: canonicalMilestone || undefined,
		};
	});
}

/**
 * Collect all unique milestone IDs from tasks and milestone entities
 */
export function collectMilestoneIds(
	tasks: Task[],
	milestoneEntities: Milestone[],
	archivedMilestones: Milestone[] = [],
): string[] {
	const merged: string[] = [];
	const seen = new Set<string>();
	const aliasMap = buildMilestoneAliasMap(milestoneEntities, archivedMilestones);

	const addMilestone = (value: string) => {
		const normalized = normalizeMilestoneName(value);
		if (!normalized) return;
		const key = milestoneKey(normalized);
		if (seen.has(key)) return;
		seen.add(key);
		merged.push(normalized);
	};

	// Add milestone entities first (they have priority for ordering)
	for (const entity of milestoneEntities) {
		addMilestone(entity.id);
	}

	// Then add any milestones from tasks that aren't in entities
	for (const task of tasks) {
		addMilestone(canonicalizeMilestoneValue(task.milestone, aliasMap));
	}

	return merged;
}

/**
 * Get the display label for a milestone
 * Uses the milestone entity title if available, otherwise returns the ID
 */
export function getMilestoneLabel(milestoneId: string | undefined, milestoneEntities: Milestone[]): string {
	if (!milestoneId) {
		return "Tasks without milestone";
	}
	const entity = milestoneEntities.find((m) => milestoneKey(m.id) === milestoneKey(milestoneId));
	return entity?.title || milestoneId;
}

/**
 * Check if a status represents a "done" state (substring fallback for display).
 * Prefer isTerminalStatus with project statuses for completion/eligibility decisions.
 */
export function isDoneStatus(status?: string | null): boolean {
	const normalized = (status ?? "").toLowerCase();
	return normalized.includes("done") || normalized.includes("complete");
}

/**
 * Prefer terminal status when statuses are known; fall back to substring done detection.
 */
export function isCompletedTaskStatus(status: string | null | undefined, statuses: readonly string[]): boolean {
	if (statuses.length > 0) {
		return isTerminalStatus(status, statuses);
	}
	return isDoneStatus(status);
}

/**
 * Activity date used for age-based cleanup (updatedDate, else createdDate).
 */
export function getTaskActivityDate(task: Pick<Task, "updatedDate" | "createdDate">): string | undefined {
	return task.updatedDate || task.createdDate || undefined;
}

/**
 * Max activity date across tasks, or undefined if none have dates.
 */
export function getLatestTaskActivityDate(tasks: Array<Pick<Task, "updatedDate" | "createdDate">>): string | undefined {
	let latest: string | undefined;
	let latestMs = Number.NEGATIVE_INFINITY;
	for (const task of tasks) {
		const dateStr = getTaskActivityDate(task);
		if (!dateStr) continue;
		const ms = new Date(dateStr).getTime();
		if (Number.isNaN(ms)) continue;
		if (ms >= latestMs) {
			latestMs = ms;
			latest = dateStr;
		}
	}
	return latest;
}

/**
 * True when a milestone has at least one task and every task is terminal/completed.
 */
export function isMilestoneFullyCompleted(tasks: Array<Pick<Task, "status">>, statuses: readonly string[]): boolean {
	if (tasks.length === 0) {
		return false;
	}
	return tasks.every((task) => isCompletedTaskStatus(task.status, statuses));
}

/**
 * Active milestones that are fully completed and whose latest task activity is older than olderThanDays.
 */
export function getCompletedMilestonesOlderThan(
	milestones: Milestone[],
	tasks: Task[],
	statuses: string[],
	olderThanDays: number,
	now: Date = new Date(),
): CompletedMilestoneCandidate[] {
	if (olderThanDays < 0 || !Number.isFinite(olderThanDays)) {
		return [];
	}

	const canonicalTasks = canonicalizeTaskMilestones(tasks, milestones, []);
	const cutoffDate = new Date(now);
	cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

	const candidates: CompletedMilestoneCandidate[] = [];

	for (const milestone of milestones) {
		const bucketKey = milestoneKey(milestone.id);
		if (!bucketKey) continue;

		const milestoneTasks = canonicalTasks.filter((task) => milestoneKey(task.milestone) === bucketKey);
		if (!isMilestoneFullyCompleted(milestoneTasks, statuses)) {
			continue;
		}

		const completedAt = getLatestTaskActivityDate(milestoneTasks);
		if (!completedAt) {
			continue;
		}

		const completedDate = new Date(completedAt);
		if (Number.isNaN(completedDate.getTime()) || completedDate >= cutoffDate) {
			continue;
		}

		candidates.push({
			milestone,
			completedAt,
			taskCount: milestoneTasks.length,
			tasks: milestoneTasks,
		});
	}

	return candidates;
}

/**
 * Create a milestone bucket for a given milestone
 */
function createBucket(
	milestoneId: string | undefined,
	tasks: Task[],
	statuses: string[],
	milestoneEntities: Milestone[],
	isNoMilestone: boolean,
): MilestoneBucket {
	const bucketMilestoneKey = milestoneKey(milestoneId);
	const bucketTasks = tasks.filter((task) => {
		const taskMilestoneKey = milestoneKey(task.milestone);
		return bucketMilestoneKey ? taskMilestoneKey === bucketMilestoneKey : !taskMilestoneKey;
	});

	const counts: Record<string, number> = {};
	for (const status of statuses) {
		counts[status] = 0;
	}
	for (const task of bucketTasks) {
		const status = task.status ?? "";
		counts[status] = (counts[status] ?? 0) + 1;
	}

	const doneCount = bucketTasks.filter((t) => isCompletedTaskStatus(t.status, statuses)).length;
	const progress = bucketTasks.length > 0 ? Math.round((doneCount / bucketTasks.length) * 100) : 0;
	const isCompleted = !isNoMilestone && isMilestoneFullyCompleted(bucketTasks, statuses);

	const key = bucketMilestoneKey ? bucketMilestoneKey : NO_MILESTONE_KEY;
	const label = getMilestoneLabel(milestoneId, milestoneEntities);

	return {
		key,
		label,
		milestone: milestoneId,
		isNoMilestone,
		isCompleted,
		tasks: bucketTasks,
		statusCounts: counts,
		total: bucketTasks.length,
		doneCount,
		progress,
	};
}

/**
 * Build milestone buckets from tasks and milestone entities
 */
export function buildMilestoneBuckets(
	tasks: Task[],
	milestoneEntities: Milestone[],
	statuses: string[],
	options?: { archivedMilestoneIds?: string[]; archivedMilestones?: Milestone[] },
): MilestoneBucket[] {
	const archivedKeys = new Set((options?.archivedMilestoneIds ?? []).map((id) => milestoneKey(id)));
	const canonicalTasks = canonicalizeTaskMilestones(tasks, milestoneEntities, options?.archivedMilestones ?? []);
	const normalizedTasks =
		archivedKeys.size > 0
			? canonicalTasks.map((task) => {
					const key = milestoneKey(task.milestone);
					if (!key || !archivedKeys.has(key)) {
						return task;
					}
					return { ...task, milestone: undefined };
				})
			: canonicalTasks;
	const filteredMilestones =
		archivedKeys.size > 0
			? milestoneEntities.filter((milestone) => !archivedKeys.has(milestoneKey(milestone.id)))
			: milestoneEntities;

	const allMilestoneIds = collectMilestoneIds(normalizedTasks, filteredMilestones);

	const buckets: MilestoneBucket[] = [
		createBucket(undefined, normalizedTasks, statuses, filteredMilestones, true),
		...allMilestoneIds.map((m) => createBucket(m, normalizedTasks, statuses, filteredMilestones, false)),
	];

	return buckets;
}

/**
 * Build a complete milestone summary
 */
export function buildMilestoneSummary(
	tasks: Task[],
	milestoneEntities: Milestone[],
	statuses: string[],
	options?: { archivedMilestoneIds?: string[]; archivedMilestones?: Milestone[] },
): MilestoneSummary {
	const archivedKeys = new Set((options?.archivedMilestoneIds ?? []).map((id) => milestoneKey(id)));
	const canonicalTasks = canonicalizeTaskMilestones(tasks, milestoneEntities, options?.archivedMilestones ?? []);
	const normalizedTasks =
		archivedKeys.size > 0
			? canonicalTasks.map((task) => {
					const key = milestoneKey(task.milestone);
					if (!key || !archivedKeys.has(key)) {
						return task;
					}
					return { ...task, milestone: undefined };
				})
			: canonicalTasks;
	const filteredMilestones =
		archivedKeys.size > 0
			? milestoneEntities.filter((milestone) => !archivedKeys.has(milestoneKey(milestone.id)))
			: milestoneEntities;
	const milestones = collectMilestoneIds(normalizedTasks, filteredMilestones, options?.archivedMilestones ?? []);
	const buckets = buildMilestoneBuckets(normalizedTasks, filteredMilestones, statuses, options);

	return {
		milestones,
		buckets,
	};
}
