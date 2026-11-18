// Focus rings paint with the focus colour (--focus-colour, the contract's
// `focusRing`: the accent, or `text` where the accent is below 3:1 on panel,
// raised or chrome), never with --accent directly: a rule whose selector holds
// `:focus` must not draw its outline in --accent.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = resolve(__dirname, '../../..');
/** Rebuilt by the app-frame work (#99) in parallel; it moves to --focus-ring there. */
const PENDING: string[] = [];

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.svelte') ? [join(dir, e.name)] : []
	);
}

function offenders(text: string): string[] {
	const css = text.slice(text.indexOf('<style'));
	return [...css.matchAll(/([^{}]*:focus[^{}]*)\{([^}]*)\}/g)]
		.filter((m) => /outline(-color)?\s*:[^;]*var\(--accent\)/.test(m[2]))
		.map((m) => m[1].trim());
}

describe('focus rings', () => {
	const files = walk(src)
		.map((p) => p.slice(src.length + 1))
		.filter((rel) => !rel.startsWith('lib/theme/') && !/(^|\/)testing\//.test(rel));

	it('no :focus outline in --accent', () => {
		const bad = files
			.filter((rel) => !PENDING.includes(rel))
			.flatMap((rel) => offenders(readFileSync(join(src, rel), 'utf8')).map((s) => `${rel}: ${s}`));
		expect(bad).toEqual([]);
	});

	it('the pending files still have one (else remove them)', () => {
		for (const rel of PENDING) expect(offenders(readFileSync(join(src, rel), 'utf8')).length, rel).toBeGreaterThan(0);
	});
});
