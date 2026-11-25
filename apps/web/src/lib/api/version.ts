import { api } from './client';

/** What a native shell implements, or what this server's web app uses from one (docs/contracts/version/). */
export interface Bridge {
	level: number;
	features: string[];
}

/** GET /api/version: public; commit and buildDate only for a full session. */
export interface VersionInfo {
	app: 'qinqin';
	version: string;
	contract: number;
	bridge: Bridge;
	commit?: string;
	buildDate?: string;
}

/** Not called by a screen today; the Android first-run screen (apps/android) does this check itself. */
export function getVersion(): Promise<VersionInfo> {
	return api('/api/version');
}

export type BridgeStatus = 'ok' | 'shellOutdated' | 'serverOutdated';

export interface BridgeCompatibility {
	status: BridgeStatus;
	/** Features the server uses that the shell lacks, sorted; empty unless status is shellOutdated. */
	missing: string[];
}

/**
 * bridgeCompatibility compares the server's bridge with the shell's own (docs/contracts/version/bridge-compat.json):
 * shellOutdated when the shell's level is lower or it lacks features the server lists (the shell can be updated, a
 * server may not be, so this wins), serverOutdated when the shell's level is higher, else ok.
 */
export function bridgeCompatibility(server: Bridge, shell: Bridge): BridgeCompatibility {
	const has = new Set(shell.features);
	const missing = [...new Set(server.features)].filter((f) => !has.has(f)).sort();
	if (shell.level < server.level || missing.length > 0) return { status: 'shellOutdated', missing };
	if (shell.level > server.level) return { status: 'serverOutdated', missing: [] };
	return { status: 'ok', missing: [] };
}
