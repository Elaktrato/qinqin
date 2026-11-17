import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import allowlist from './allowlist.json';
import pending from './pending.json';
import { intlFindings, langFindings, markupFindings, tsFindings, type Finding } from './lint';

// The lint against hard-coded interface strings, fixed-locale formatting and literal `lang` attributes (spec
// "Lint against new hard-coded strings"; heuristics and their unit cases: lint.ts, lint.test.ts).
//
// - text: every non-test .svelte file's markup, and sentence-like literals in non-test .ts under lib/ and routes/.
// - intl: `Intl.*Format(`, `Intl.PluralRules(`, `toLocale*String(` outside lib/i18n/.
// - lang: a literal `lang="…"` in markup (study text takes `studyLang`, interface text inherits <html lang>).
//
// A finding fails unless allowlist.json names it ({file, text, reason}) or pending.json lists its file under
// the rule (the extraction baseline: files not yet moved to the catalogue; it only shrinks).

const src = resolve(__dirname, '../..');

type Rule = 'text' | 'intl' | 'lang';
const pendingFiles: Record<Rule, string[]> = pending;

/** Test support never ships: tests, `*.test.svelte` stubs, declaration files and `testing/` folders. */
const isLinted = (rel: string): boolean =>
	/\.(svelte|ts)$/.test(rel) && !/\.test\.(ts|svelte)$/.test(rel) && !rel.endsWith('.d.ts') && !/(^|\/)testing\//.test(rel);

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else out.push(p.slice(src.length + 1));
	}
	return out;
}
const files = walk(src).filter(isLinted).sort();

function findings(rel: string): Record<Rule, Finding[]> {
	const text = readFileSync(join(src, rel), 'utf8');
	const svelte = rel.endsWith('.svelte');
	const tsScope = /^(lib|routes)\//.test(rel);
	return {
		text: [...(svelte ? markupFindings(text) : []), ...(tsScope ? tsFindings(text, svelte) : [])],
		intl: rel.startsWith('lib/i18n/') ? [] : intlFindings(text, svelte),
		lang: svelte ? langFindings(text) : []
	};
}
const all = new Map(files.map((f) => [f, findings(f)]));
const allowed = (rel: string, f: Finding): boolean => allowlist.some((a) => a.file === rel && a.text === f.text);

describe('the walk', () => {
	it('covers every non-test source file vite sees', () => {
		const globbed = Object.keys(import.meta.glob('/src/**/*.{svelte,ts}'))
			.map((p) => p.replace(/^\/src\//, ''))
			.filter(isLinted)
			.sort();
		expect(globbed.length).toBeGreaterThan(300);
		expect(files).toEqual(globbed);
	});
});

describe.each(['text', 'intl', 'lang'] as const)('%s lint', (rule) => {
	it('no finding outside the allowlist and the pending files', () => {
		const bad = files.flatMap((rel) =>
			pendingFiles[rule].includes(rel)
				? []
				: all.get(rel)![rule].filter((f) => !allowed(rel, f)).map((f) => `${rel}:${f.line}: ${f.text}`)
		);
		expect(bad).toEqual([]);
	});

	it('pending lists only existing files that still have findings, sorted', () => {
		const stale = pendingFiles[rule].filter((rel) => !all.has(rel) || all.get(rel)![rule].every((f) => allowed(rel, f)));
		expect(stale).toEqual([]);
		expect(pendingFiles[rule]).toEqual([...pendingFiles[rule]].sort());
	});
});

describe('allowlist.json', () => {
	it('every entry has a reason and still matches a finding', () => {
		const unused = allowlist.filter((a) => {
			const f = all.get(a.file);
			return a.reason.trim() === '' || f === undefined || ![...f.text, ...f.intl, ...f.lang].some((x) => x.text === a.text);
		});
		expect(unused).toEqual([]);
	});
});
