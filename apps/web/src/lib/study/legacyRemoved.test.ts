// The v0.3 compatibility layer is gone (#198) and stays gone: no app module
// reads the v1 review outbox, guards typed study keys as plugin data, parses
// the old keyed study rows, runs the plugin study-event hook or filters the
// synthesized data-pack plugin rows (docs/contracts/CHANGELOG.md).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '..', '..');

function files(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...files(p));
		else if (/\.(svelte|ts)$/.test(p)) out.push(p);
	}
	return out;
}

/** App modules: no tests, no test-only helpers (lib/study/testing builds old-shaped test data). */
const app = files(src)
	.map((p) => relative(src, p))
	.filter((rel) => !/\.test\.(ts|svelte)$/.test(rel) && !/(^|\/)testing\//.test(rel));

const banned: [string, RegExp][] = [
	['the v1 outbox key', /qinqin\.study\.pending(?!\.v2)/],
	['the typed-key guard', /\blegacyFamily\b/],
	['the keyed study-row parsers', /\b(parseLimitRow|parseDeckSettings|serializeDeckSettings|parseParamSet)\b/],
	['the plugin study-event hook', /\b(emitStudyEvents|registerStudyEventHandler|onStudyEvent|setHookStates)\b/],
	['the data-pack plugin row filter', /\bisDataPackPlugin\b/]
];

describe('the v0.3 compatibility layer stays removed', () => {
	for (const [what, pattern] of banned) {
		it(`no app module has ${what}`, () => {
			expect(app.filter((rel) => pattern.test(readFileSync(join(src, rel), 'utf8')))).toEqual([]);
		});
	}
});
