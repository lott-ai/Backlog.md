import { describe, expect, it } from "bun:test";
import type { ListInterface, ScreenInterface } from "neo-neo-bblessed";
import { GenericList } from "../ui/components/generic-list.ts";
import { createScreen } from "../ui/tui.ts";

type RenderedList = ListInterface & {
	emit: (event: string, ch?: string, key?: { name: string }) => boolean;
	ritems: string[];
	selected?: number;
};

function withTtyScreen(run: (screen: ScreenInterface) => void): void {
	const originalIsTTY = process.stdout.isTTY;
	if (process.stdout.isTTY === false) {
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
	}
	const screen = createScreen({ smartCSR: false });
	try {
		run(screen);
	} finally {
		if (process.stdout.isTTY !== originalIsTTY) {
			Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
		}
		screen.destroy();
	}
}

describe("GenericList selection rendering", () => {
	it("reports each multi-select toggle in picker order without confirming or cancelling", () => {
		withTtyScreen((screen) => {
			const changes: Array<{ selected: string[]; indices: number[] }> = [];
			const confirmations: string[][] = [];
			const list = new GenericList({
				parent: screen,
				items: [{ id: "TASK-1" }, { id: "TASK-2" }, { id: "TASK-3" }],
				multiSelect: true,
				selectedIndices: [2],
				showHelp: false,
				onSelectionChange: (selected, indices) => {
					changes.push({
						selected: selected.map((item) => item.id),
						indices: [...indices],
					});
				},
				onSelect: (selected) => {
					confirmations.push(Array.isArray(selected) ? selected.map((item) => item.id) : []);
				},
			});

			const listBox = list.getListBox() as RenderedList;
			listBox.emit("key down", "", { name: "down" });
			expect(changes).toEqual([]);

			listBox.emit("key space", " ", { name: "space" });
			expect(changes).toEqual([{ selected: ["TASK-2", "TASK-3"], indices: [1, 2] }]);
			expect(confirmations).toEqual([]);

			listBox.emit("key space", " ", { name: "space" });
			expect(changes.at(-1)).toEqual({ selected: ["TASK-3"], indices: [2] });

			listBox.emit("key down", "", { name: "down" });
			listBox.emit("key space", " ", { name: "space" });
			expect(changes.at(-1)).toEqual({ selected: [], indices: [] });
			expect(changes).toHaveLength(3);

			listBox.emit("key enter", "", { name: "enter" });
			expect(confirmations).toEqual([[]]);
			expect(changes).toHaveLength(3);

			listBox.emit("key escape", "", { name: "escape" });
			expect(confirmations).toEqual([[], []]);
			expect(changes).toHaveLength(3);

			list.destroy();
		});
	});

	it("syncs highlighted content when the blessed list selection changes", () => {
		withTtyScreen((screen) => {
			const highlighted: number[] = [];
			const list = new GenericList({
				parent: screen,
				items: [{ id: "TASK-1" }, { id: "TASK-2" }],
				itemRenderer: (item) => `{cyan-fg}${item.id}{/}`,
				onHighlight: (_item, index) => {
					highlighted.push(index);
				},
				showHelp: false,
			});

			const listBox = list.getListBox() as RenderedList;
			expect(listBox.ritems[0]).toBe("TASK-1");
			expect(listBox.ritems[1]).toBe("{cyan-fg}TASK-2{/}");

			listBox.select(1);

			expect(listBox.ritems[0]).toBe("{cyan-fg}TASK-1{/}");
			expect(listBox.ritems[1]).toBe("TASK-2");
			expect(list.getSelectedIndex()).toBe(1);
			expect(highlighted.at(-1)).toBe(1);

			list.destroy();
		});
	});

	it("uses display-index mapping for page navigation in grouped lists", () => {
		withTtyScreen((screen) => {
			const highlighted: number[] = [];
			const list = new GenericList({
				parent: screen,
				items: [
					{ id: "TASK-1", group: "One" },
					{ id: "TASK-2", group: "One" },
					{ id: "TASK-3", group: "Two" },
				],
				groupBy: (item: { group?: string }) => item.group ?? "",
				itemRenderer: (item) => item.id,
				onHighlight: (_item, index) => {
					highlighted.push(index);
				},
				showHelp: false,
			});

			const listBox = list.getListBox() as RenderedList;
			listBox.emit("key end", "", { name: "end" });

			expect(list.getSelectedIndex()).toBe(2);
			expect(listBox.selected).toBe(4);
			expect(highlighted.at(-1)).toBe(2);

			list.destroy();
		});
	});
});
