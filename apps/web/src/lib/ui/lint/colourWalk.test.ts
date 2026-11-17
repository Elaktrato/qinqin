// The colour lint over src/ (#98 PART B; heuristics and unit cases: colours.ts, colours.test.ts).
//
// - Scanned: every `.svelte` and `.css` file under src/.
// - Exempt by path: the theme machinery (`lib/theme/**`: it reads the OS preference and paints the tokens by design),
//   test support (`*.test.svelte`, `testing/` folders — never shipped). `.ts` files are not scanned; `app.html`
//   (the first paint) is not a `.svelte`/`.css` file.
// - allowlist.json: `{file, text, reason}` — a literal that must stay (reason required); an entry that matches
//   nothing fails.
// - pending.json: the ratchet baseline while the migration lands in batches — a listed file may still hold
//   findings, a clean listed file fails ("remove it"), and the list may only shrink (PENDING_LENGTH).
//   `UPDATE_COLOUR_PENDING=1` rewrites it from the current findings.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import allowlist from './allowlist.json';
import pending from './pending.json';
import { colourFindings, type Finding } from './colours';

/** The pinned length of pending.json: each migration batch lowers it. */
const PENDING_LENGTH = 93;

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
const all = new Map<string, Finding[]>(
	files.map((rel) => [
		rel,
		colourFindings(readFileSync(join(src, rel), 'utf8'), rel.endsWith('.css') ? 'css' : 'svelte')
	])
);
const allowed = (rel: string, f: Finding): boolean => allowlist.some((a) => a.file === rel && a.text === f.text);
const offenders = files.filter((rel) => all.get(rel)!.some((f) => !allowed(rel, f)));

if (process.env.UPDATE_COLOUR_PENDING === '1') {
	writeFileSync(join(__dirname, 'pending.json'), JSON.stringify(offenders, null, '\t') + '\n');
}

describe('colour lint', () => {
	it('walks the components and the global CSS', () => {
		expect(files.length).toBeGreaterThan(150);
		expect(files).toContain('app.css');
	});

	it('no colour literal and no prefers-color-scheme outside the allowlist and the pending files', () => {
		const bad = files.flatMap((rel) =>
			pending.includes(rel)
				? []
				: all
						.get(rel)!
						.filter((f) => !allowed(rel, f))
						.map((f) => `${rel}:${f.line}: ${f.text}`)
		);
		expect(bad).toEqual([]);
	});

	it('pending lists only existing files that still have findings, sorted, and only shrinks', () => {
		const stale = pending.filter((rel) => !offenders.includes(rel));
		expect(stale, 'clean now: remove from pending.json').toEqual([]);
		expect(pending).toEqual([...pending].sort());
		expect(pending.length).toBe(PENDING_LENGTH);
	});

	it('every allowlist entry has a reason and matches a finding', () => {
		for (const a of allowlist) {
			expect(a.reason.trim().length, `${a.file} ${a.text}`).toBeGreaterThan(10);
			expect(
				all.get(a.file)?.some((f) => f.text === a.text),
				`${a.file} ${a.text} matches nothing`
			).toBe(true);
		}
	});
});
