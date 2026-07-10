import { describe, expect, it } from "bun:test";
import { getCompletedMilestonesOlderThan, isMilestoneFullyCompleted } from "../core/milestones.ts";
import type { Milestone, Task } from "../types/index.ts";

const STATUSES = ["To Do", "In Progress", "Done"];

function makeMilestone(id: string, title: string): Milestone {
	return {
		id,
		title,
		description: "",
		rawContent: "",
	};
}

function makeTask(partial: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task {
	return {
		assignee: [],
		createdDate: "2026-01-01",
		labels: [],
		dependencies: [],
		rawContent: "",
		...partial,
	};
}

describe("milestone cleanup eligibility", () => {
	const now = new Date("2026-07-01T12:00:00Z");

	it("selects fully terminal milestones older than the age threshold", () => {
		const milestones = [makeMilestone("m-1", "Release")];
		const tasks = [
			makeTask({
				id: "task-1",
				title: "A",
				status: "Done",
				milestone: "m-1",
				updatedDate: "2026-06-01",
			}),
			makeTask({
				id: "task-2",
				title: "B",
				status: "Done",
				milestone: "m-1",
				updatedDate: "2026-06-10",
			}),
		];

		const candidates = getCompletedMilestonesOlderThan(milestones, tasks, STATUSES, 7, now);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.milestone.id).toBe("m-1");
		expect(candidates[0]?.completedAt).toBe("2026-06-10");
		expect(candidates[0]?.taskCount).toBe(2);
	});

	it("does not select milestones with any non-terminal task", () => {
		const milestones = [makeMilestone("m-1", "Release")];
		const tasks = [
			makeTask({
				id: "task-1",
				title: "A",
				status: "Done",
				milestone: "m-1",
				updatedDate: "2026-01-01",
			}),
			makeTask({
				id: "task-2",
				title: "B",
				status: "In Progress",
				milestone: "m-1",
				updatedDate: "2026-01-01",
			}),
		];

		expect(getCompletedMilestonesOlderThan(milestones, tasks, STATUSES, 0, now)).toHaveLength(0);
		expect(isMilestoneFullyCompleted(tasks, STATUSES)).toBe(false);
	});

	it("does not select empty milestones", () => {
		const milestones = [makeMilestone("m-1", "Empty")];
		expect(getCompletedMilestonesOlderThan(milestones, [], STATUSES, 0, now)).toHaveLength(0);
		expect(isMilestoneFullyCompleted([], STATUSES)).toBe(false);
	});

	it("does not select milestones completed within the age window", () => {
		const milestones = [makeMilestone("m-1", "Recent")];
		const tasks = [
			makeTask({
				id: "task-1",
				title: "A",
				status: "Done",
				milestone: "m-1",
				updatedDate: "2026-06-28",
			}),
		];

		expect(getCompletedMilestonesOlderThan(milestones, tasks, STATUSES, 7, now)).toHaveLength(0);
		expect(getCompletedMilestonesOlderThan(milestones, tasks, STATUSES, 1, now)).toHaveLength(1);
	});

	it("uses terminal status from config instead of substring matching alone", () => {
		const statuses = ["To Do", "Review", "Closed"];
		const milestones = [makeMilestone("m-1", "Closed MS")];
		const tasks = [
			makeTask({
				id: "task-1",
				title: "A",
				status: "Closed",
				milestone: "m-1",
				updatedDate: "2026-01-01",
			}),
		];

		expect(getCompletedMilestonesOlderThan(milestones, tasks, statuses, 0, now)).toHaveLength(1);
		expect(
			getCompletedMilestonesOlderThan(
				milestones,
				[
					makeTask({
						id: "task-1",
						title: "A",
						status: "Done",
						milestone: "m-1",
						updatedDate: "2026-01-01",
					}),
				],
				statuses,
				0,
				now,
			),
		).toHaveLength(0);
	});

	it("matches tasks via canonical milestone ids after title assignment", () => {
		const milestones = [makeMilestone("m-2", "Release 2")];
		const tasks = [
			makeTask({
				id: "task-1",
				title: "A",
				status: "Done",
				milestone: "Release 2",
				updatedDate: "2026-01-01",
			}),
		];

		const candidates = getCompletedMilestonesOlderThan(milestones, tasks, STATUSES, 0, now);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.milestone.id).toBe("m-2");
	});
});
