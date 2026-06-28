import { afterEach, describe, expect, it } from "bun:test";
import { InvalidServerPortError, resolveServerPort } from "../utils/resolve-server-port.ts";

describe("resolveServerPort", () => {
	const originalPort = process.env.PORT;

	afterEach(() => {
		if (originalPort === undefined) {
			delete process.env.PORT;
		} else {
			process.env.PORT = originalPort;
		}
	});

	it("prefers CLI port over PORT env, config, and fallback", () => {
		process.env.PORT = "4000";
		expect(
			resolveServerPort({
				cliPort: "3000",
				configPort: 6420,
				fallback: 6420,
			}),
		).toBe(3000);
	});

	it("uses PORT env when CLI port is not set", () => {
		process.env.PORT = "4567";
		expect(
			resolveServerPort({
				configPort: 6420,
				fallback: 6420,
			}),
		).toBe(4567);
	});

	it("uses config port when CLI and PORT are not set", () => {
		delete process.env.PORT;
		expect(
			resolveServerPort({
				configPort: 6420,
				fallback: 6421,
			}),
		).toBe(6420);
	});

	it("uses fallback when nothing else is set", () => {
		delete process.env.PORT;
		expect(
			resolveServerPort({
				fallback: 6421,
			}),
		).toBe(6421);
	});

	it("rejects invalid ports", () => {
		expect(() =>
			resolveServerPort({
				cliPort: "0",
				fallback: 6420,
			}),
		).toThrow(InvalidServerPortError);
		expect(() =>
			resolveServerPort({
				cliPort: "70000",
				fallback: 6420,
			}),
		).toThrow(InvalidServerPortError);
	});
});
