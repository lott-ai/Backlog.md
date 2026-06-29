import { describe, expect, it } from "bun:test";
import { formatVersionDisplay, getCommitSha, getVersion } from "../utils/version.ts";

describe("version display", () => {
	it("returns package version in development", async () => {
		const version = await getVersion();
		const packageJson = await Bun.file("package.json").json();
		expect(version).toBe(packageJson.version);
	});

	it("includes commit sha in plain version output", async () => {
		const version = await getVersion();
		const commit = await getCommitSha();
		const output = await formatVersionDisplay({ color: false });

		if (commit) {
			expect(output).toBe(`${version} (${commit})`);
		} else {
			expect(output).toBe(version);
		}
	});

	it("wraps commit sha in gray styling when color is enabled", async () => {
		const commit = await getCommitSha();
		if (!commit) {
			return;
		}

		const output = await formatVersionDisplay({ color: true });
		expect(output).toContain(`\u001B[90m(${commit})\u001B[39m`);
	});
});
