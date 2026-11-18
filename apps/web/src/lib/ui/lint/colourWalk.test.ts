// The style lints over src/: PART B's `colour` (no literal colour, no prefers-color-scheme: colours.ts) and
// `opacity` (no text faded with opacity: opacity.ts), plus #106's restyle rules (restyle.ts):
//   weight  — type tops out at 600 (no 650, 700, bold, bolder)
//   caps    — sentence case (no text-transform: uppercase/capitalize, no small-caps)
//   border  — hairlines: a border wider than 1px outside focus and selected states
//   shadow  — only --shadow-float, none, or a hairline inset
//   control — a raw text-like <button>/<select>/<input> in a page file #106 owns (lib/ui/** exempt: it owns the
//             controls). Only the files PAGES names with owner '#106' are scanned for it; checkbox, radio, file,
//             range, colour and the one-time-code input are allowed.
//
// - Scanned: every `.svelte` and `.css` file under src/.
// - Exempt by path: the theme machinery (`lib/theme/**`: it reads the OS preference and paints the tokens by design),
//   test support (`*.test.svelte`, `testing/` folders — never shipped). `.ts` files are not scanned; `app.html`
//   (the first paint) is not a `.svelte`/`.css` file.
// - allowlist.json: `{rule, file, text, within?, count, reason}` — a finding that must stay (reason required): `text`
//   in `file`, on a source line that holds `within` when given (app.css's `rgb(` only in the `--shadow-float`
//   declaration); exactly `count` findings match, so a new one of the same text in the same file fails.
// - pending.json: per rule, the ratchet baseline while the migration lands in batches — a listed file may still
//   hold findings, a clean listed file fails ("remove it"), and each list may only shrink (PENDING_LENGTH).
//   `UPDATE_STYLE_PENDING=1` rewrites it from the current findings. #106's lists are seeded from this tree and
//   lowered as pages are restyled; P26 names the remainder.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import allowlist from './allowlist.json';
import pending from './pending.json';
import { colourFindings, type Finding, type StyleKind } from './colours';
import { opacityFindings } from './opacity';
import { stalePending, type RestyleRule, restyleFindings } from './restyle';
import { PAGES } from './pages';

type Rule = 'colour' | 'opacity' | RestyleRule;

const RULES: Rule[] = ['colour', 'opacity', 'weight', 'caps', 'border', 'shadow', 'control'];

/** The pinned lengths of pending.json: each migration batch lowers them. */
const PENDING_LENGTH: Record<Rule, number> = {
	colour: 0,
	opacity: 0,
	weight: 4,
	caps: 7,
	border: 16,
	shadow: 5,
	control: 4
};

const LINTS: Record<'colour' | 'opacity', (src: string, kind: StyleKind) => Finding[]> = {
	colour: colourFindings,
	opacity: opacityFindings
};

/** Files the manifest names with owner '#106': the only ones the `control` rule scans. */
const CONTROL_FILES = new Set(
	PAGES.filter((page) => page.owner === '#106').flatMap((page) => page.files)
);

const src = resolve(__dirname, '../../..');

const isScanned = (rel: string): boolean =>
	/\.(svelte|css)$/.test(rel) &&
	!/\.test\.svelte$/.test(rel) &&
	!/(^|\/)testing\//.test(rel) &&
	!rel.startsWith('lib/theme/');

/** The `control` rule: a page file #106 owns, never the base components (lib/ui owns the controls). */
export const scannedForControl = (rel: string): boolean =>
	CONTROL_FILES.has(rel) && !rel.startsWith('lib/ui/');

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
const restyleOf = new Map(files.map((rel) => [rel, restyleFindings(sources.get(rel)!, kindOf(rel))]));

function findingsOf(rule: Rule, rel: string): Finding[] {
	if (rule === 'colour' || rule === 'opacity') return LINTS[rule](sources.get(rel)!, kindOf(rel));
	if (rule === 'control' && !scannedForControl(rel)) return [];
	return restyleOf.get(rel)!.filter((f) => f.rule === rule);
}

const all: Record<Rule, Map<string, Finding[]>> = Object.fromEntries(
	RULES.map((rule) => [rule, new Map(files.map((rel) => [rel, findingsOf(rule, rel)]))])
) as Record<Rule, Map<string, Finding[]>>;

type Entry = { rule: string; file: string; text: string; within?: string; count: number; reason: string };
const entries: Entry[] = allowlist;

/** Whether allowlist entry `a` admits finding `f` of `rel` (whose source is `src`). */
function admits(a: Entry, rel: string, f: Finding, src: string): boolean {
	if (a.file !== rel || a.text !== f.text) return false;
	return a.within === undefined || (src.split('\n')[f.line - 1] ?? '').includes(a.within);
}
const allowed = (rule: Rule, rel: string, f: Finding): boolean =>
	entries.some((a) => a.rule === rule && admits(a, rel, f, sources.get(rel)!));
const offenders = (rule: Rule): string[] =>
	files.filter((rel) => all[rule].get(rel)!.some((f) => !allowed(rule, rel, f)));

if (process.env.UPDATE_STYLE_PENDING === '1') {
	const next = Object.fromEntries(RULES.map((rule) => [rule, offenders(rule)]));
	writeFileSync(join(__dirname, 'pending.json'), JSON.stringify(next, null, '\t') + '\n');
}

describe('the walk', () => {
	it('covers the components and the global CSS', () => {
		expect(files.length).toBeGreaterThan(150);
		expect(files).toContain('app.css');
	});
});

describe('the allowed raw controls', () => {
	it('control scans only the page files #106 owns, never lib/ui', () => {
		expect(scannedForControl('routes/login/+page.svelte')).toBe(true);
		expect(scannedForControl('routes/sources/+page.svelte')).toBe(true);
		expect(scannedForControl('lib/ui/Field.svelte')).toBe(false);
		expect(scannedForControl('routes/+page.svelte')).toBe(false);
		expect(scannedForControl('lib/widgets/ActivityHome.svelte')).toBe(false);
	});
});

describe('the allowlist matching', () => {
	const shadow = entries.find((a) => a.file === 'app.css' && a.text === 'rgb(')!;
	const css = ':root {\n\t--shadow-float: 0 1px 3px rgb(0 0 0 / 0.12);\n\t--glow: rgb(255 0 0);\n}\n';

	it("app.css's rgb( is admitted only in the --shadow-float declaration", () => {
		expect(shadow.within).toBe('--shadow-float:');
		const found = colourFindings(css, 'css');
		expect(found.map((f) => admits(shadow, 'app.css', f, css))).toEqual([true, false]);
	});
});

describe.each(RULES)('%s lint', (rule) => {
	const list: string[] = pending[rule] ?? [];

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
		const stale = stalePending(list, offenders(rule));
		expect(stale, 'clean now: remove from pending.json').toEqual([]);
		expect(list).toEqual([...list].sort());
		expect(list.length).toBe(PENDING_LENGTH[rule]);
	});

	it('every allowlist entry has a reason and matches exactly its count of findings', () => {
		for (const a of entries.filter((x) => x.rule === rule)) {
			expect(a.reason.trim().length, `${a.file} ${a.text}`).toBeGreaterThan(10);
			expect(Number.isInteger(a.count) && a.count > 0, `${a.file} ${a.text} count`).toBe(true);
			const matched = (all[rule].get(a.file) ?? []).filter((f) => admits(a, a.file, f, sources.get(a.file)!));
			expect(matched.length, `${a.file} ${a.text}`).toBe(a.count);
		}
	});
});
