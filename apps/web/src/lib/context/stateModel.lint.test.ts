// The state model's guards (record 0009, #196). Shared state lives in runes
// classes that the app context or the session owns, reached through Svelte
// context; nothing per user hides in a module. A source scan, not an AST
// analysis:
// - no file under src/ imports svelte/store;
// - no file exports a `…ForTests` reset: a test builds a fresh context instead;
// - no module-level mutable state (a `let` or `var`, an empty Map or Set, an
//   instance of another class, whatever a `create…(` factory builds, a store
//   or a rune, an empty array or object filled later, a small object of
//   counters or slots such as `{ current: null }`) in src/lib or src/routes,
//   unless ALLOWED names it with the reason it holds nothing of a user. WeakMaps are not flagged: they hold nothing once the
//   keyed objects (owned by a session or a component) are dropped.
// The service worker (src/service-worker.ts) is its own global with no
// session: its API cache is per credential and is not scanned here.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const LIB = join(SRC, 'lib');

/** file (relative to src/) + name -> why it is not per-user state. */
const ALLOWED: Record<string, string> = {
	'lib/i18n/index.ts:language': 'the interface language of the page: installed before mount, a change reloads the page',
	'lib/i18n/index.ts:messages': 'the interface catalogue of that language, the same way',
	'lib/i18n/index.ts:fmtLocale': 'the formatting locale of that language, the same way',
	'lib/i18n/index.ts:warned': 'missing-key warnings already logged: catalogue keys, no user data',
	'lib/i18n/format.ts:cache': 'Intl formatters by locale and options',
	'lib/i18n/message.ts:parsedCache': 'parsed catalogue messages',
	'lib/i18n/message.ts:safeLocales': 'locale tags',
	'lib/i18n/message.ts:pluralRules': 'Intl.PluralRules by locale',
	'lib/i18n/message.ts:numberFormats': 'Intl.NumberFormat by locale',
	'lib/time/studyDay.ts:formatters': 'Intl.DateTimeFormat by zone',
	'lib/radicals/kangxi.ts:numbers': 'built from the bundled Kangxi table at load',
	'lib/components/map/CharGrid.svelte:waiting': 'render jobs of mounted grids, no data',
	'lib/components/map/CharGrid.svelte:pumping': 'whether a render frame is scheduled, no data',
	'lib/features/flashcards/Mascot.svelte:probes': 'whether bundled mascot images exist, no user data',
	'lib/features/reader/variants.ts:converters': 'script converters built from bundled tables',
	'lib/features/reader/variants.ts:loading': 'the converter tables loading, no user data',
	'lib/study/scheduler.ts:schedulers': "ts-fsrs instances by weight values (at most 16): a pure function's memo, no rows",
	'lib/milestones/reached.ts:nextIdentity': 'a counter that tells objects apart, no data',
	'lib/milestones/replayReached.ts:nextIdentity': 'a counter that tells objects apart, no data',
	'lib/api/client.ts:observer': "the one observer slot of the API client: the app context installs it at start and removes it at dispose",
	'lib/weekly/replay.ts:replayStats': 'an operation counter the performance tests read, no user data',
	'lib/weekly/summary.ts:summaryStats': 'an operation counter the performance tests read, no user data',
	'lib/milestones/reached.ts:reachedStats': 'an operation counter the performance tests read, no user data',
	'lib/time/studyDay.ts:studyDayStats': 'an operation counter the performance tests read, no user data',
	'lib/api/client.ts:memoryToken': 'the credential itself (storage blocked): clearToken drops it at every session end'
};

export interface Finding {
	name: string;
	line: number;
}

// A module-level declaration (column 0) of something that changes at runtime.
const DECLARATIONS: RegExp[] = [
	// any let or var
	/^(?:export\s+)?(?:let|var)\s+(\w+)\b/,
	// an empty Map / Set (a constant table has initial values)
	/^(?:export\s+)?const\s+(\w+)[^=]*=\s*new\s+(?:Map|Set)\b[^(]*\(\s*\)/,
	// an instance of any other class (WeakMaps and regular expressions hold no state of their own)
	/^(?:export\s+)?const\s+(\w+)[^=]*=\s*new\s+(?!(?:Map|Set|WeakMap|WeakSet|RegExp)\b)[\w.]+/,
	// whatever a factory builds
	/^(?:export\s+)?const\s+(\w+)[^=]*=\s*create\w*\(/,
	// a store or a rune at module level
	/^(?:export\s+)?const\s+(\w+)[^=]*=\s*(?:writable|readable|\$state)(?:\.raw)?(?:<[^=]*>)?\(/,
	// an empty array or object literal (a Record filled later), with or without a cast
	/^(?:export\s+)?const\s+(\w+)[^=]*=\s*(?:\[\]|\{\})\s*(?:as\s+[^;]+)?;/,
	// a small object of counters or slots (`{ current: null }`, `{ passes: 0 }`); an ALL_CAPS name is a constant
	/^(?:export\s+)?const\s+(?![A-Z0-9_]+\b)(\w+)[^=]*=\s*\{\s*(?:\w+\s*:\s*(?:null|undefined|true|false|-?\d+|\[\]|\{\})\s*,?\s*)+\}/
];

/** findState lists the module-level declarations of one source text that look like runtime-changed state. */
export function findState(source: string): Finding[] {
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

const STORE_IMPORT = /\bfrom\s+['"]svelte\/store['"]|\bimport\s*\(\s*['"]svelte\/store['"]\s*\)/;
const FOR_TESTS_EXPORT = /^\s*export\b[^\n]*\b(\w*ForTests)\b/m;

/** The module script of a Svelte component (`<script module>`), or ''. */
function moduleScript(svelte: string): string {
	const m = /<script\b[^>]*\bmodule\b[^>]*>([\s\S]*?)<\/script>/.exec(svelte);
	return m === null ? '' : m[1].replace(/^\t/gm, '');
}

/** Every .ts and .svelte file under `dir`; `tests` also keeps tests and test helpers. */
function sources(dir: string, tests: boolean): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (tests || name !== 'testing') out.push(...sources(path, tests));
			continue;
		}
		if (name.endsWith('.d.ts')) continue;
		if (!tests && name.endsWith('.test.ts')) continue;
		if (name.endsWith('.ts') || name.endsWith('.svelte')) out.push(path);
	}
	return out;
}

const rel = (path: string) => relative(SRC, path).split('\\').join('/');

describe('findState', () => {
	it('flags the usual shapes and nothing else', () => {
		const planted = [
			'const cache = new Map<number, string>();',
			'export const seen = new Set<string>();',
			'const shared = createStudyDataCache(load);',
			'let memo: Thing | null = null;',
			'let timer: number | null = null;',
			"const KNOWN = new Set(['a', 'b']);",
			'const keys = new WeakMap<object, string>();',
			'\tconst local = new Map();',
			'\tlet inner = 0;',
			'export const report = writable<Report | null>(null);',
			'const rows = $state.raw<Row[]>([]);',
			'const providers: Provider[] = [];',
			'const byId: Record<string, Row> = {};',
			"const LABELS = ['a'];",
			'var legacy = 1;',
			'const outbox = new ReviewOutbox(deps);',
			'export const player = createPlayer();',
			'const queue = [] as Job[];',
			'const slot = { current: null };',
			'export const stats = { passes: 0, hits: 0 };',
			"const TABLE = new Map([['a', 1]]);",
			'const pattern = new RegExp("x");',
			'const EMPTY: Pair = { a: null, b: null };',
			"const library: Route = { view: 'library' };"
		].join('\n');
		expect(findState(planted).map((f) => f.name)).toEqual([
			'cache', 'seen', 'shared', 'memo', 'timer', 'report', 'rows', 'providers', 'byId',
			'legacy', 'outbox', 'player', 'queue', 'slot', 'stats'
		]);
	});

	it('the import and export patterns catch what they name', () => {
		expect(STORE_IMPORT.test("import { writable } from 'svelte/store';")).toBe(true);
		expect(STORE_IMPORT.test('const m = await import("svelte/store");')).toBe(true);
		expect(STORE_IMPORT.test("import { tick } from 'svelte';")).toBe(false);
		expect(FOR_TESTS_EXPORT.exec('export function resetForTests(): void {}')?.[1]).toBe('resetForTests');
		expect(FOR_TESTS_EXPORT.exec('export { clear as clearForTests };')?.[1]).toBe('clearForTests');
		expect(FOR_TESTS_EXPORT.test('function resetForTests(): void {}')).toBe(false);
	});
});

describe('the state model (record 0009)', () => {
	// This file names the patterns it looks for.
	const all = sources(SRC, true).filter((path) => path !== fileURLToPath(import.meta.url));

	it('no file under src/ imports svelte/store', () => {
		const found = all.filter((path) => STORE_IMPORT.test(readFileSync(path, 'utf8'))).map(rel);
		expect(found).toEqual([]);
	});

	it('no file exports a …ForTests reset', () => {
		const found: string[] = [];
		for (const path of all) {
			const m = FOR_TESTS_EXPORT.exec(readFileSync(path, 'utf8'));
			if (m) found.push(`${rel(path)} ${m[1]}`);
		}
		expect(found).toEqual([]);
	});

	it('no module-level mutable state in src/lib or src/routes outside the allowlist', () => {
		const unlisted: string[] = [];
		const used = new Set<string>();
		for (const path of [...sources(LIB, false), ...sources(join(SRC, 'routes'), false)]) {
			const raw = readFileSync(path, 'utf8');
			const source = path.endsWith('.svelte') ? moduleScript(raw) : raw;
			for (const f of findState(source)) {
				const key = `${rel(path)}:${f.name}`;
				if (key in ALLOWED) used.add(key);
				else unlisted.push(`${rel(path)}:${f.line} ${f.name}`);
			}
		}
		expect(unlisted).toEqual([]);
		// A stale allowlist entry hides nothing and must go.
		expect(Object.keys(ALLOWED).filter((key) => !used.has(key))).toEqual([]);
	});
});
