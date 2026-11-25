// Checking a server address: GET <origin>/api/version (docs/contracts/version/README.md) through a native HTTP
// function (CapacitorHttp: no CORS, the shell's own network stack), and what the answer means. Pure apart from
// the injected `http`; no DOM, no Capacitor (verify.test.ts).

/** What a native shell implements, or what a server's web app uses from one. */
export interface Bridge {
	level: number;
	features: string[];
}

export type BridgeStatus = 'ok' | 'shellOutdated' | 'serverOutdated';
export interface BridgeCompatibility {
	status: BridgeStatus;
	missing: string[];
}

/** The rule of docs/contracts/version/bridge-compat.json (the web app's lib/api/version.ts has the same). */
export function bridgeCompatibility(server: Bridge, shell: Bridge): BridgeCompatibility {
	const has = new Set(shell.features);
	const missing = [...new Set(server.features)].filter((f) => !has.has(f)).sort();
	if (shell.level < server.level || missing.length > 0) return { status: 'shellOutdated', missing };
	if (shell.level > server.level) return { status: 'serverOutdated', missing: [] };
	return { status: 'ok', missing: [] };
}

/**
 * What this shell implements: level 1 (back button, safe areas) and the optional feature `status-bar`
 * (QinqinShell.setBars). The server lists the features its web app uses WHEN PRESENT (`status-bar` among them,
 * docs/contracts/version/); the shell lists what it has; a feature the server names and the shell lacks is a
 * warning. This copy and the web app's lib/api/version.ts are the same rule (bridge-compat.json pins both):
 * the first-run screen is a separate bundle in the APK and cannot import the web app's code.
 */
export const SHELL_BRIDGE: Bridge = { level: 1, features: ['files', 'haptics', 'keep-awake', 'local-notifications', 'share', 'status-bar', 'tts'] };

export interface HttpAnswer {
	status: number;
	/** The URL that finally answered (after redirects). */
	url: string;
	data: unknown;
	/** Response headers (any case); only Location is read, for a redirect the stack did not follow. */
	headers?: Record<string, string>;
}
export type HttpFn = (url: string) => Promise<HttpAnswer>;

export type FailureKind = 'unreachable' | 'timeout' | 'tls' | 'notQinqin' | 'redirect';

export type VerifyResult =
	| { ok: true; version: string; compat: BridgeCompatibility; bridge: Bridge }
	| { ok: false; kind: Exclude<FailureKind, 'redirect'> }
	| { ok: false; kind: 'redirect'; target: string };

/** classifyFailure maps what CapacitorHttp rejected with (code = the Java exception class) to a failure kind. */
export function classifyFailure(e: unknown): 'unreachable' | 'timeout' | 'tls' {
	const o = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; message?: unknown };
	const text = `${typeof o.code === 'string' ? o.code : ''} ${typeof o.message === 'string' ? o.message : ''}`;
	if (/ssl|cert|trust anchor|handshake/i.test(text)) return 'tls';
	if (/timeout|timed out/i.test(text)) return 'timeout';
	return 'unreachable';
}

function parseAnswer(data: unknown): { version: string; bridge: Bridge } | null {
	let v = data;
	if (typeof v === 'string') {
		try {
			v = JSON.parse(v);
		} catch {
			return null;
		}
	}
	if (typeof v !== 'object' || v === null) return null;
	const o = v as Record<string, unknown>;
	if (o.app !== 'qinqin' || typeof o.version !== 'string') return null;
	const b = o.bridge as Partial<Bridge> | null | undefined;
	if (!b || typeof b.level !== 'number' || !Array.isArray(b.features) || !b.features.every((f) => typeof f === 'string')) return null;
	return { version: o.version, bridge: { level: b.level, features: b.features } };
}

function originOf(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

/** verifyServer asks `origin` who it is and how it compares with the shell's bridge. */
export async function verifyServer(origin: string, http: HttpFn, shell: Bridge = SHELL_BRIDGE): Promise<VerifyResult> {
	let answer: HttpAnswer;
	try {
		answer = await http(`${origin}/api/version`);
	} catch (e) {
		return { ok: false, kind: classifyFailure(e) };
	}
	const finalOrigin = originOf(answer.url);
	if (finalOrigin !== null && finalOrigin !== originOf(origin)) return { ok: false, kind: 'redirect', target: finalOrigin };
	// http to https is not followed by the native stack (a different protocol): the 3xx and its Location arrive here.
	if (answer.status >= 300 && answer.status < 400) {
		const location = Object.entries(answer.headers ?? {}).find(([k]) => k.toLowerCase() === 'location')?.[1];
		if (location) {
			let target: string | null = null;
			try {
				target = new URL(location, answer.url).origin;
			} catch {
				// not a URL: treated as not qinqin
			}
			if (target !== null && target !== originOf(origin)) return { ok: false, kind: 'redirect', target };
		}
	}
	const parsed = answer.status === 200 ? parseAnswer(answer.data) : null;
	if (!parsed) return { ok: false, kind: 'notQinqin' };
	return { ok: true, version: parsed.version, bridge: parsed.bridge, compat: bridgeCompatibility(parsed.bridge, shell) };
}
