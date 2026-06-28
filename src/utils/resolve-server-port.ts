export interface ResolveServerPortOptions {
	cliPort?: string | number;
	configPort?: number;
	fallback: number;
}

export class InvalidServerPortError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidServerPortError";
	}
}

function parsePortValue(value: string | number | undefined): number | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		return undefined;
	}
	return parsed;
}

function assertValidPort(port: number): number {
	if (port < 1 || port > 65535) {
		throw new InvalidServerPortError("Invalid port number. Must be between 1 and 65535.");
	}
	return port;
}

/**
 * Resolve the HTTP port for backlog browser servers.
 * Precedence: CLI flag > PORT env > config defaultPort > fallback.
 */
export function resolveServerPort(options: ResolveServerPortOptions): number {
	const cliPort = parsePortValue(options.cliPort);
	if (cliPort !== undefined) {
		return assertValidPort(cliPort);
	}

	const envPort = parsePortValue(process.env.PORT);
	if (envPort !== undefined) {
		return assertValidPort(envPort);
	}

	const configPort = parsePortValue(options.configPort);
	if (configPort !== undefined) {
		return assertValidPort(configPort);
	}

	return assertValidPort(options.fallback);
}
