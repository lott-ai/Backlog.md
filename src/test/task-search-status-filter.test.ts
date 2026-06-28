import { describe, expect, test } from "bun:test";
import type { Task } from "../types/index.ts";
import {
	applyTaskFilters,
	createTaskSearchIndex,
	normalizeStatusFilter,
	resolveConfiguredStatuses,
} from "../utils/task-search.ts";

const tasks: Task[] = [
	{
		id: "task-1",
		title: "Todo item",
		status: "To Do",
		labels: [],
		assignee: [],
		createdDate: "2025-01-01",
		dependencies: [],
	},
	{
		id: "task-2",
		title: "In progress item",
		status: "In Progress",
		labels: [],
		assignee: [],
		createdDate: "2025-01-02",
		dependencies: [],
	},
	{
		id: "task-3",
		title: "Done item",
		status: "Done",
		labels: [],
		assignee: [],
		createdDate: "2025-01-03",
		dependencies: [],
	},
];

describe("createTaskSearchIndex status filtering", () => {
	test("returns all tasks when no status filter is provided", () => {
		const index = createTaskSearchIndex(tasks);
		expect(index.search({}).map((task) => task.id)).toEqual(["task-1", "task-2", "task-3"]);
	});

	test("filters tasks by a single status", () => {
		const index = createTaskSearchIndex(tasks);
		expect(index.search({ status: "To Do" }).map((task) => task.id)).toEqual(["task-1"]);
	});

	test("filters tasks by multiple statuses with OR semantics", () => {
		const index = createTaskSearchIndex(tasks);
		expect(index.search({ status: ["To Do", "In Progress"] }).map((task) => task.id)).toEqual(["task-1", "task-2"]);
	});

	test("matches status case-insensitively", () => {
		const index = createTaskSearchIndex(tasks);
		expect(index.search({ status: "in progress" }).map((task) => task.id)).toEqual(["task-2"]);
	});
});

describe("applyTaskFilters status filtering", () => {
	test("applies multi-status filters through applyTaskFilters", () => {
		const results = applyTaskFilters(tasks, { status: ["To Do", "Done"] }).map((task) => task.id);
		expect(results).toEqual(["task-1", "task-3"]);
	});
});

describe("createTaskSearchIndex priority filtering", () => {
	test("filters tasks by multiple priorities with OR semantics", () => {
		const priorityTasks: Task[] = [
			{
				id: "task-1",
				title: "High priority",
				status: "To Do",
				priority: "high",
				labels: [],
				assignee: [],
				createdDate: "2025-01-01",
				dependencies: [],
			},
			{
				id: "task-2",
				title: "Medium priority",
				status: "To Do",
				priority: "medium",
				labels: [],
				assignee: [],
				createdDate: "2025-01-02",
				dependencies: [],
			},
			{
				id: "task-3",
				title: "Low priority",
				status: "To Do",
				priority: "low",
				labels: [],
				assignee: [],
				createdDate: "2025-01-03",
				dependencies: [],
			},
		];
		const index = createTaskSearchIndex(priorityTasks);
		expect(index.search({ priority: ["high", "medium"] }).map((task) => task.id)).toEqual(["task-1", "task-2"]);
	});
});

describe("applyTaskFilters milestone filtering", () => {
	test("filters tasks by multiple milestones with OR semantics", () => {
		const milestoneTasks: Task[] = [
			{
				id: "task-1",
				title: "Sprint 1 task",
				status: "To Do",
				milestone: "Sprint 1",
				labels: [],
				assignee: [],
				createdDate: "2025-01-01",
				dependencies: [],
			},
			{
				id: "task-2",
				title: "Sprint 2 task",
				status: "To Do",
				milestone: "Sprint 2",
				labels: [],
				assignee: [],
				createdDate: "2025-01-02",
				dependencies: [],
			},
			{
				id: "task-3",
				title: "Sprint 3 task",
				status: "To Do",
				milestone: "Sprint 3",
				labels: [],
				assignee: [],
				createdDate: "2025-01-03",
				dependencies: [],
			},
		];
		const results = applyTaskFilters(milestoneTasks, { milestone: ["Sprint 1", "Sprint 2"] }).map((task) => task.id);
		expect(results).toEqual(["task-1", "task-2"]);
	});
});

describe("status filter helpers", () => {
	test("normalizeStatusFilter flattens and trims values", () => {
		expect(normalizeStatusFilter([" To Do ", "In Progress"])).toEqual(["to do", "in progress"]);
		expect(normalizeStatusFilter("Done")).toEqual(["done"]);
		expect(normalizeStatusFilter([])).toBeUndefined();
	});

	test("resolveConfiguredStatuses maps to configured casing", () => {
		const configured = ["To Do", "In Progress", "Done"];
		expect(resolveConfiguredStatuses(["to do", "IN PROGRESS"], configured)).toEqual(["To Do", "In Progress"]);
	});
});
