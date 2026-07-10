import { describe, expect, it } from "bun:test";
import type { ListInterface, ScreenInterface } from "neo-neo-bblessed";
import { openMultiSelectFilterPopup } from "../ui/components/filter-popup.ts";
import { createScreen } from "../ui/tui.ts";

type RenderedList = ListInterface & {
	emit: (event: string, ch?: string, key?: { name: string }) => boolean;
};

async function withTtyScreen(run: (screen: ScreenInterface) => Promise<void>): Promise<void> {
	const originalIsTTY = process.stdout.isTTY;
	if (process.stdout.isTTY === false) {
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
	}
	const screen = createScreen({ smartCSR: false });
	try {
		await run(screen);
	} finally {
		if (process.stdout.isTTY !== originalIsTTY) {
			Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
		}
		screen.destroy();
	}
}

function getFocusedList(screen: ScreenInterface): RenderedList {
	return (screen as unknown as { focused: RenderedList }).focused;
}

describe("openMultiSelectFilterPopup", () => {
	it("reports live selections before confirmation and preserves the existing enter contract", async () => {
		await withTtyScreen(async (screen) => {
			const changes: string[][] = [];
			let settled = false;
			const result = openMultiSelectFilterPopup({
				screen,
				title: "Filter",
				items: ["alpha", "beta"],
				selectedItems: ["beta"],
				onSelectionChange: (selected) => changes.push([...selected]),
			}).then((value) => {
				settled = true;
				return value;
			});

			await Bun.sleep(0);
			const picker = getFocusedList(screen);
			picker.emit("key space", " ", { name: "space" });

			expect(changes).toEqual([["alpha", "beta"]]);
			expect(settled).toBe(false);

			picker.emit("key enter", "", { name: "enter" });
			expect(await result).toEqual(["alpha", "beta"]);
		});
	});

	it("resolves cancellation as null without emitting a live change", async () => {
		await withTtyScreen(async (screen) => {
			const changes: string[][] = [];
			const result = openMultiSelectFilterPopup({
				screen,
				title: "Filter",
				items: ["alpha"],
				selectedItems: [],
				onSelectionChange: (selected) => changes.push([...selected]),
			});

			await Bun.sleep(0);
			getFocusedList(screen).emit("key escape", "", { name: "escape" });

			expect(await result).toBeNull();
			expect(changes).toEqual([]);
		});
	});
});
