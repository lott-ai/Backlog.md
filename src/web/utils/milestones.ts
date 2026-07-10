/**
 * Re-export milestone utilities from core for backward compatibility
 * All business logic lives in src/core/milestones.ts
 */

export type { CompletedMilestoneCandidate } from "../../core/milestones.ts";
export {
	buildMilestoneBuckets,
	buildMilestoneSummary,
	collectArchivedMilestoneKeys,
	collectMilestoneIds,
	getCompletedMilestonesOlderThan,
	getLatestTaskActivityDate,
	getMilestoneLabel,
	getTaskActivityDate,
	isCompletedTaskStatus,
	isDoneStatus,
	isMilestoneFullyCompleted,
	milestoneKey,
	normalizeMilestoneName,
	validateMilestoneName,
} from "../../core/milestones.ts";
// Re-export types from core types
export type { MilestoneBucket, MilestoneSummary } from "../../types/index.ts";
