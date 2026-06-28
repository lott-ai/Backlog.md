import { describe, expect, it } from "bun:test";
import { GlobalBacklogServer } from "../server/global.ts";

describe("GlobalBacklogServer", () => {
	it("exposes global mode on /api/status", async () => {
		const server = new GlobalBacklogServer();
		await server.start(0, false);
		try {
			const port = server.getPort();
			expect(port).not.toBeNull();
			const response = await fetch(`http://localhost:${port}/api/status`);
			expect(response.ok).toBe(true);
			const body = await response.json();
			expect(body.mode).toBe("global");
			expect(body.initialized).toBe(true);
			expect(Array.isArray(body.projects)).toBe(true);
		} finally {
			await server.stop();
		}
	});
});
