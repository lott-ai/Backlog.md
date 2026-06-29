import { describe, expect, it } from "bun:test";
import type { Task } from "../types/index.ts";
import { hasAnyPrefix } from "../utils/prefix-config.ts";

const createTestTask = (id: string, dependencies: string[] = []): Task => ({
	id,
	title: `Task ${id}`,
	status: "To Do",
	assignee: [],
	createdDate: "2025-01-01",
	labels: [],
	dependencies,
});

function createSessionHarness(initialTasks: Task[]) {
	let tasks = [...initialTasks];
	const emitted: Task[][] = [];

	const getRenderableTasks = () => tasks.filter((task) => task.id && task.id.trim() !== "" && hasAnyPrefix(task.id));
	const emitBoardUpdate = () => {
		emitted.push(getRenderableTasks());
	};

	const removeTaskFromSession = (taskId: string) => {
		tasks = tasks.filter((task) => task.id !== taskId);
		emitBoardUpdate();
	};

	const onTaskChanged = (task: Task) => {
		const idx = tasks.findIndex((existing) => existing.id === task.id);
		if (idx >= 0) {
			tasks[idx] = task;
		} else {
			tasks.push(task);
		}
		emitBoardUpdate();
	};

	return {
		emitted,
		getRenderableTasks,
		removeTaskFromSession,
		onTaskChanged,
	};
}

describe("TUI session sync", () => {
	it("keeps archived task removed when sanitize side-effects trigger onTaskChanged first", () => {
		const archived = createTestTask("task-1");
		const dependent = createTestTask("task-2", ["task-1"]);
		const harness = createSessionHarness([archived, dependent]);

		harness.removeTaskFromSession("task-1");
		harness.onTaskChanged({
			...dependent,
			dependencies: [],
		});

		const latestEmission = harness.emitted.at(-1) ?? [];
		expect(latestEmission.map((task) => task.id)).toEqual(["task-2"]);
		expect(harness.getRenderableTasks().map((task) => task.id)).toEqual(["task-2"]);
	});

	it("does not reintroduce removed tasks when onTaskChanged runs before onTaskRemoved", () => {
		const archived = createTestTask("task-1");
		const other = createTestTask("task-2");
		const harness = createSessionHarness([archived, other]);

		harness.onTaskChanged({
			...other,
			title: "Updated title",
		});
		harness.removeTaskFromSession("task-1");

		const latestEmission = harness.emitted.at(-1) ?? [];
		expect(latestEmission.some((task) => task.id === "task-1")).toBe(false);
	});
});
