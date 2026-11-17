// Text colours that must read (docs/contracts/themes/README.md, "Derived
// tokens"): theme colours that can fall below 4.5:1 on panel are never used
// as a text colour directly; the derived readable tokens are.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '..', '..');

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return /\.(svelte|css)$/.test(name) ? [path] : [];
	});
}

/** The places that set `color:` (not border-color, background-color …) to the token. */
function textUses(token: string): string[] {
	const re = new RegExp(`(^|[^-\\w])color:\\s*var\\(${token}\\b`, 'g');
	return files(src).flatMap((path) => {
		const text = readFileSync(path, 'utf8');
		return [...text.matchAll(re)].map((m) => {
			const line = text.slice(0, m.index).split('\n').length;
			return `${relative(src, path)}:${line}`;
		});
	});
}

describe('readable text colours', () => {
	it('error text uses --readable-bad, never --bad (Nord bad is 3.05:1 on panel)', () => {
		expect(textUses('--bad')).toEqual([]);
	});
});
