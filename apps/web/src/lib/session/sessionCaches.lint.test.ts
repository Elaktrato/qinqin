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
const SRC = fileURLToPath(new URL('../..', import.meta.url));

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
	'session/sessionEnd.ts:clears': 'the registry itself',
	'account/logoutFlow.ts:logoutPrompt': 'the open state of the sign-out prompt, no data',
	'components/map/CharGrid.svelte:waiting': 'render jobs of mounted grids, no data',
	'features/flashcards/Mascot.svelte:probes': 'whether bundled mascot images exist, no user data',
	'features/flashcards/decks/providers.ts:pluginDeckProviders': 'deck providers plugins register at load, no data',
	'features/reader/variants.ts:converters': 'script converters built from bundled tables',
	'features/reader/variants.ts:loading': 'the converter tables loading, no user data',
	'frame/pageFrame.svelte.ts:slots': 'layout slots of the mounted page, no data',
	'pwa/install.ts:installPrompt': 'the browser install prompt event, device state',
	'time/zone.ts:pending': 'the zone load in flight; clearStudyDay moves the zone epoch, so a late answer is dropped',
	'api/client.ts:memoryToken': 'the credential itself (storage blocked): clearToken drops it on every session end',
	'workspaceGone.ts:inFlight': 'a shared workspace-list reload in flight; it holds no data and the list store is reset by the layout per token'
};

export interface Finding {
	name: string;
	line: number;
}

// A module-level declaration (column 0) of something filled at runtime.
const DECLARATIONS: RegExp[] = [
	// an empty Map / Set (a constant table has initial values)
	/^(?:export\s+)?(?:const|let)\s+(\w+)[^=]*=\s*new\s+(?:Map|Set)\b[^(]*\(\s*\)/,
	// a cache built by a factory
	/^(?:export\s+)?(?:const|let)\s+(\w+)[^=]*=\s*create\w*Cache\(/,
	// a cache-named let
	/^(?:export\s+)?let\s+((?:cache|memo|inflight|inFlight|pending|loaded)\w*)\b/,
	// a store or a rune at module level
	/^(?:export\s+)?(?:const|let)\s+(\w+)[^=]*=\s*(?:writable|\$state)(?:<[^=]*>)?\(/,
	// an empty array or object literal (a Record filled later)
	/^(?:export\s+)?(?:const|let)\s+(\w+)[^=]*=\s*(?:\[\]|\{\})\s*;/
];

/** findCaches lists the module-level declarations of one source text that look like runtime-filled state. */
export function findCaches(source: string): Finding[] {
	const out: Finding[] = [];
	source.split('\n').forEach((text, i) => {
		for (const re of DECLARATIONS) {
			const m = re.exec(text);
			if (m) {
				out.push({ name: m[1], line: i + 1 });
				return;
			}
		}
	});
	return out;
}

/** The text from `open` (an opening paren) to its matching close. */
function balanced(source: string, open: number): string {
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === '(' || source[i] === '{') depth++;
		else if (source[i] === ')' || source[i] === '}') {
			depth--;
			if (depth === 0) return source.slice(open, i + 1);
		}
	}
	return source.slice(open);
}

/**
 * sessionEndText: every onSessionEnd(...) callback of a source, with the
 * bodies of the same-file functions and methods it calls folded in (two
 * levels deep), so `onSessionEnd(() => clearX())` counts what clearX clears.
 */
export function sessionEndText(source: string): string {
	const parts: string[] = [];
	for (let at = source.indexOf('onSessionEnd('); at >= 0; at = source.indexOf('onSessionEnd(', at + 1)) {
		parts.push(balanced(source, at + 'onSessionEnd'.length));
	}
	let text = parts.join('\n');
	for (let depth = 0; depth < 2; depth++) {
		const called = new Set([...text.matchAll(/\b(\w+)\s*\(/g)].map((m) => m[1]));
		for (const name of called) {
			const def = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
			if (def === null) continue;
			const body = source.indexOf('{', source.indexOf(')', def.index));
			text += '\n' + balanced(source, body);
		}
	}
	return text;
}

/** The module script of a Svelte component (`<script module>`), or ''. */
function moduleScript(svelte: string): string {
	const m = /<script\b[^>]*\bmodule\b[^>]*>([\s\S]*?)<\/script>/.exec(svelte);
	return m === null ? '' : m[1].replace(/^\t/gm, '');
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
		if (name.endsWith('.test.ts') || name.endsWith('.d.ts')) continue;
		if (name.endsWith('.ts') || name.endsWith('.svelte')) out.push(path);
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
			'let timer: number | null = null;',
			'export const report = writable<Report | null>(null);',
			'let rows = $state<Row[]>([]);',
			'const providers: Provider[] = [];',
			'const byId: Record<string, Row> = {};',
			"const LABELS = ['a'];"
		].join('\n');
		expect(findCaches(planted).map((f) => f.name)).toEqual(['cache', 'seen', 'shared', 'memo', 'inFlight', 'report', 'rows', 'providers', 'byId']);
	});
});

describe('sessionEndText', () => {
	it('counts what a callback clears, through the same-file functions it calls, per name', () => {
		const source = [
			'const a = new Map<string, number>();',
			'const b = new Map<string, number>();',
			'export function clearA(): void {',
			'\ta.clear();',
			'}',
			'onSessionEnd(() => clearA());',
			'function unrelated(): void { b.clear(); }'
		].join('\n');
		const text = sessionEndText(source);
		expect(text).toMatch(/\ba\.clear/);
		// b is cleared somewhere, but not at the session end: still flagged.
		expect(text).not.toMatch(/\bb\.clear/);
	});
});

describe('every module-level cache in src/lib and src/routes is cleared at the session end (#173)', () => {
	it('names each declaration inside an onSessionEnd callback, or allowlists it', () => {
		const unregistered: string[] = [];
		const used = new Set<string>();
		for (const path of [...sources(LIB), ...sources(join(SRC, 'routes'))]) {
			const rel = relative(LIB, path).split('\\').join('/');
			const raw = readFileSync(path, 'utf8');
			const source = path.endsWith('.svelte') ? moduleScript(raw) : raw;
			const found = findCaches(source);
			if (found.length === 0) continue;
			const cleared = sessionEndText(source);
			for (const f of found) {
				const key = `${rel}:${f.name}`;
				if (new RegExp(`\\b${f.name}\\b`).test(cleared)) continue;
				if (key in ALLOWED) used.add(key);
				else unregistered.push(`${rel}:${f.line} ${f.name}`);
			}
		}
		expect(unregistered).toEqual([]);
		// A stale allowlist entry hides nothing and must go.
		expect(Object.keys(ALLOWED).filter((key) => !used.has(key))).toEqual([]);
	});
});
