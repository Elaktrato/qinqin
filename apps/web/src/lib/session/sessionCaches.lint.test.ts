// #173: a module-level cache must register with onSessionEnd (sessionEnd.ts),
// or sign-out leaves the previous user's data behind. A heuristic, not an AST
// analysis: it flags the usual shapes of a runtime-filled module cache — an
// empty `new Map()` / `new Set()`, a `create…Cache(` and a `let cache/memo/
// inflight/pending/loaded…` — in a file of src/lib that never calls
// onSessionEnd(, unless ALLOWED names it with a reason. WeakMaps are not
// flagged: they hold nothing once the keyed objects (owned by registered
// caches or by components) are dropped.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const LIB = fileURLToPath(new URL('..', import.meta.url));

/** file (relative to src/lib) + name -> why it is not a per-user cache. */
const ALLOWED: Record<string, string> = {
	'i18n/index.ts:warned': 'missing-key warnings already logged: catalogue keys, no user data',
	'i18n/format.ts:cache': 'Intl formatters by locale and options',
	'i18n/message.ts:parsedCache': 'parsed catalogue messages',
	'i18n/message.ts:safeLocales': 'locale tags',
	'i18n/message.ts:pluralRules': 'Intl.PluralRules by locale',
	'i18n/message.ts:numberFormats': 'Intl.NumberFormat by locale',
	'time/studyDay.ts:formatters': 'Intl.DateTimeFormat by zone',
	'radicals/kangxi.ts:numbers': 'built from the bundled Kangxi table at load',
	'api/client.ts:memoryToken': 'the credential itself (storage blocked): clearToken drops it on every session end',
	'workspaceGone.ts:inFlight': 'a shared workspace-list reload in flight; it holds no data and the list store is reset by the layout per token'
};

export interface Finding {
	name: string;
	line: number;
}

const EMPTY_COLLECTION = /^(?:export\s+)?(?:const|let)\s+(\w+)[^=]*=\s*new\s+(?:Map|Set)\b[^(]*\(\s*\)/;
const CREATED_CACHE = /^(?:export\s+)?(?:const|let)\s+(\w+)[^=]*=\s*create\w*Cache\(/;
const CACHE_LET = /^(?:export\s+)?let\s+((?:cache|memo|inflight|inFlight|pending|loaded)\w*)\b/;

/** findCaches lists the module-level cache declarations of one source file. */
export function findCaches(source: string): Finding[] {
	const out: Finding[] = [];
	source.split('\n').forEach((text, i) => {
		const m = EMPTY_COLLECTION.exec(text) ?? CREATED_CACHE.exec(text) ?? CACHE_LET.exec(text);
		if (m) out.push({ name: m[1], line: i + 1 });
	});
	return out;
}

function sources(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			// Test helpers, and the service worker (no session there: its API cache is per credential).
			if (name !== 'testing' && name !== 'sw') out.push(...sources(path));
			continue;
		}
		if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(path);
	}
	return out;
}

describe('findCaches', () => {
	it('flags the usual shapes and nothing else', () => {
		const planted = [
			'const cache = new Map<number, string>();',
			'export const seen = new Set<string>();',
			'const shared = createStudyDataCache(load);',
			'let memo: Thing | null = null;',
			'let inFlight: Promise<void> | null = null;',
			"const KNOWN = new Set(['a', 'b']);",
			'const keys = new WeakMap<object, string>();',
			'\tconst local = new Map();',
			'let timer: number | null = null;'
		].join('\n');
		expect(findCaches(planted).map((f) => f.name)).toEqual(['cache', 'seen', 'shared', 'memo', 'inFlight']);
	});
});

describe('every module-level cache in src/lib registers with onSessionEnd (#173)', () => {
	it('has no unregistered cache outside the allowlist', () => {
		const unregistered: string[] = [];
		const used = new Set<string>();
		for (const path of sources(LIB)) {
			const rel = relative(LIB, path).split('\\').join('/');
			const source = readFileSync(path, 'utf8');
			const found = findCaches(source);
			if (found.length === 0 || source.includes('onSessionEnd(')) continue;
			for (const f of found) {
				const key = `${rel}:${f.name}`;
				if (key in ALLOWED) used.add(key);
				else unregistered.push(`${rel}:${f.line} ${f.name}`);
			}
		}
		expect(unregistered).toEqual([]);
		// A stale allowlist entry hides nothing and must go.
		expect(Object.keys(ALLOWED).filter((key) => !used.has(key))).toEqual([]);
	});
});
