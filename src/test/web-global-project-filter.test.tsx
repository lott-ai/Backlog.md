import { describe, expect, it } from "bun:test";
import { ApiClient, isGlobalStatus } from "../web/lib/api.ts";

describe("global api client", () => {
	it("detects global status shape", () => {
		expect(
			isGlobalStatus({
				mode: "global",
				initialized: true,
				projects: [],
			}),
		).toBe(true);
		expect(
			isGlobalStatus({
				initialized: true,
				projectPath: "/tmp",
			}),
		).toBe(false);
	});

	it("requires projectKey for global mutations", () => {
		const client = new ApiClient();
		client.setServerMode("global");
		expect(() => client.updateTask("task-1", { title: "x" })).toThrow("projectKey is required");
	});
});
