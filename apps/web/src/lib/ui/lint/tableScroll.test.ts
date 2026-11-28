// A table never widens the page on a phone (#296): every `.ui-table` sits
// directly in a `.ui-table-scroll` box (app.css), which scrolls sideways,
// is positioned (an absolutely positioned label inside cannot escape it) and
// is a labelled, keyboard-reachable region. The runtime check is the e2e
// phone-width guard (apps/web/e2e/support/layout.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = resolve(__dirname, '../../..');

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.svelte') ? [join(dir, e.name)] : []
	);
}

/** The `.ui-table`s of a Svelte file whose previous tag is not an opening `.ui-table-scroll` region. */
function unwrappedTables(text: string): number[] {
	const lines = text.split('\n');
	const out: number[] = [];
	lines.forEach((line, i) => {
		if (!/<table\b[^>]*class="[^"]*\bui-table\b/.test(line)) return;
		let j = i - 1;
		while (j >= 0 && (lines[j].trim() === '' || lines[j].trim().startsWith('<!--'))) j--;
		const before = j >= 0 ? lines[j] : '';
		const ok =
			/<div\b[^>]*class="[^"]*\bui-table-scroll\b/.test(before) &&
			/tabindex="0"/.test(before) &&
			/role="region"/.test(before) &&
			/aria-label(ledby)?=/.test(before);
		if (!ok) out.push(i + 1);
	});
	return out;
}

describe('tables on a phone', () => {
	it('finds a bare table and accepts a wrapped one', () => {
		expect(unwrappedTables('<div>\n\t<table class="ui-table">')).toEqual([2]);
		expect(unwrappedTables('<div class="ui-table-scroll">\n<table class="ui-table">')).toEqual([2]);
		expect(
			unwrappedTables(
				'<!-- svelte-ignore x -->\n<div class="ui-table-scroll" tabindex="0" role="region" aria-label={x}>\n\t<!-- c -->\n\t<table class="ui-table" aria-label={x}>'
			)
		).toEqual([]);
	});

	it('every .ui-table is in a .ui-table-scroll region', () => {
		const bad = walk(src)
			.filter((p) => !/(^|\/)testing\//.test(p))
			.flatMap((p) => unwrappedTables(readFileSync(p, 'utf8')).map((line) => `${p.slice(src.length + 1)}:${line}`));
		expect(bad).toEqual([]);
	});
});
