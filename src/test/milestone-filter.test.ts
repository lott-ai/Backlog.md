import { describe, expect, it } from "bun:test";
import {
	createMilestoneFilterValueResolver,
	milestonePickerLabelsToValues,
	milestoneValuesToPickerLabels,
	normalizeMilestoneFilterValue,
	resolveClosestMilestoneFilterValue,
	resolveMilestoneFilterInputs,
} from "../utils/milestone-filter.ts";

describe("milestone filter matching", () => {
	it("normalizes punctuation and case", () => {
		expect(normalizeMilestoneFilterValue("  Release-1 / Alpha ")).toBe("release 1 alpha");
	});

	it("returns exact normalized milestone when available", () => {
		const resolved = resolveClosestMilestoneFilterValue("RELEASE-1", ["Release-1", "Roadmap Alpha"]);
		expect(resolved).toBe("release 1");
	});

	it("returns closest milestone for typo input", () => {
		const resolved = resolveClosestMilestoneFilterValue("releas-1", ["Release-1", "Release-2", "Roadmap Alpha"]);
		expect(resolved).toBe("release 1");
	});

	it("returns closest milestone for partial input", () => {
		const resolved = resolveClosestMilestoneFilterValue("roadmp", ["Release-1", "Roadmap Alpha"]);
		expect(resolved).toBe("roadmap alpha");
	});

	it("resolves milestone IDs to titles for filtering", () => {
		const resolveMilestone = createMilestoneFilterValueResolver([
			{
				id: "m-7",
				title: "New Milestones UI",
				description: "",
				rawContent: "",
			},
		]);

		expect(resolveMilestone("m-7")).toBe("New Milestones UI");
		expect(resolveMilestone("7")).toBe("New Milestones UI");
		expect(resolveMilestone("New Milestones UI")).toBe("New Milestones UI");
		expect(resolveMilestone("m-99")).toBe("m-99");
	});

	it("resolves multiple milestone filter inputs for CLI filtering", () => {
		const milestones = [
			{ id: "m-1", title: "Release 1", description: "", rawContent: "" },
			{ id: "m-2", title: "Release 2", description: "", rawContent: "" },
		];

		expect(resolveMilestoneFilterInputs(["m-1", "m-2"], milestones)).toEqual(["Release 1", "Release 2"]);
		expect(resolveMilestoneFilterInputs(["Release-1", "release 2"], milestones)).toEqual(["Release 1", "Release 2"]);
		expect(resolveMilestoneFilterInputs(["m-1", "m-1", "Release 1"], milestones)).toEqual(["Release 1"]);
	});

	it("formats milestone picker labels as id and title", () => {
		const milestones = [
			{
				id: "m-0",
				title: "Spinnaker E2E runner optimization support",
				description: "",
				rawContent: "",
			},
		];

		expect(milestoneValuesToPickerLabels(["Spinnaker E2E runner optimization support"], milestones)).toEqual([
			"m-0 - Spinnaker E2E runner optimization support",
		]);
		expect(milestonePickerLabelsToValues(["m-0 - Spinnaker E2E runner optimization support"], milestones)).toEqual([
			"Spinnaker E2E runner optimization support",
		]);
	});
});
