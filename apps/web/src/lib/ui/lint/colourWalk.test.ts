// The style lints over src/ (#98 PART B): `colour` (no literal colour, no prefers-color-scheme: colours.ts) and
// `opacity` (no text faded with opacity: opacity.ts). Unit cases: colours.test.ts, opacity.test.ts.
//
// - Scanned: every `.svelte` and `.css` file under src/.
// - Exempt by path: the theme machinery (`lib/theme/**`: it reads the OS preference and paints the tokens by design),
//   test support (`*.test.svelte`, `testing/` folders — never shipped). `.ts` files are not scanned; `app.html`
//   (the first paint) is not a `.svelte`/`.css` file.
// - allowlist.json: `{rule, file, text, reason}` — a finding that must stay (reason required); an entry that matches
//   nothing fails.
// - pending.json: per rule, the ratchet baseline while the migration lands in batches — a listed file may still
//   hold findings, a clean listed file fails ("remove it"), and each list may only shrink (PENDING_LENGTH).
//   `UPDATE_STYLE_PENDING=1` rewrites it from the current findings.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import allowlist from './allowlist.json';
import pending from './pending.json';
import { colourFindings, type Finding, type StyleKind } from './colours';
import { opacityFindings } from './opacity';

type Rule = 'colour' | 'opacity';

/** The pinned lengths of pending.json: each migration batch lowers them. */
const PENDING_LENGTH: Record<Rule, number> = { colour: 93, opacity: 96 };

const LINTS: Record<Rule, (src: string, kind: StyleKind) => Finding[]> = {
	colour: colourFindings,
	opacity: opacityFindings
};

const src = resolve(__dirname, '../../..');

const isScanned = (rel: string): boolean =>
	/\.(svelte|css)$/.test(rel) &&
	!/\.test\.svelte$/.test(rel) &&
	!/(^|\/)testing\//.test(rel) &&
	!rel.startsWith('lib/theme/');

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else out.push(p.slice(src.length + 1));
	}
	return out;
}
const files = walk(src).filter(isScanned).sort();
const sources = new Map(files.map((rel) => [rel, readFileSync(join(src, rel), 'utf8')]));
const kindOf = (rel: string): StyleKind => (rel.endsWith('.css') ? 'css' : 'svelte');
const all: Record<Rule, Map<string, Finding[]>> = {
	colour: new Map(files.map((rel) => [rel, colourFindings(sources.get(rel)!, kindOf(rel))])),
	opacity: new Map(files.map((rel) => [rel, LINTS.opacity(sources.get(rel)!, kindOf(rel))]))
};
const allowed = (rule: Rule, rel: string, f: Finding): boolean =>
	allowlist.some((a) => a.rule === rule && a.file === rel && a.text === f.text);
const offenders = (rule: Rule): string[] =>
	files.filter((rel) => all[rule].get(rel)!.some((f) => !allowed(rule, rel, f)));

if (process.env.UPDATE_STYLE_PENDING === '1') {
	const next = { colour: offenders('colour'), opacity: offenders('opacity') };
	writeFileSync(join(__dirname, 'pending.json'), JSON.stringify(next, null, '\t') + '\n');
}

describe('the walk', () => {
	it('covers the components and the global CSS', () => {
		expect(files.length).toBeGreaterThan(150);
		expect(files).toContain('app.css');
	});
});

describe.each(['colour', 'opacity'] as const)('%s lint', (rule) => {
	const list: string[] = pending[rule];

	it('no finding outside the allowlist and the pending files', () => {
		const bad = files.flatMap((rel) =>
			list.includes(rel)
				? []
				: all[rule]
						.get(rel)!
						.filter((f) => !allowed(rule, rel, f))
						.map((f) => `${rel}:${f.line}: ${f.text}`)
		);
		expect(bad).toEqual([]);
	});

	it('pending lists only existing files that still have findings, sorted, and only shrinks', () => {
		const stale = list.filter((rel) => !offenders(rule).includes(rel));
		expect(stale, 'clean now: remove from pending.json').toEqual([]);
		expect(list).toEqual([...list].sort());
		expect(list.length).toBe(PENDING_LENGTH[rule]);
	});

	it('every allowlist entry has a reason and matches a finding', () => {
		for (const a of allowlist.filter((x) => x.rule === rule)) {
			expect(a.reason.trim().length, `${a.file} ${a.text}`).toBeGreaterThan(10);
			expect(
				all[rule].get(a.file)?.some((f) => f.text === a.text),
				`${a.file} ${a.text} matches nothing`
			).toBe(true);
		}
	});
});
