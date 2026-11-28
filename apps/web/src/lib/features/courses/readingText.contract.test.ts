import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../docs/contracts/segment/cases.json';
import type { SegmentMatch } from '$lib/api/types';
import { readingParts, unreachedEntries } from './readingText';

// The fixture's tokens as /api/segment sends them with readings: offsets in
// text order, one entry and a reading per token, `function` only when true.
function matchesOf(c: (typeof fixture.cases)[number]): SegmentMatch[] {
	const chars = [...c.text];
	let at = 0;
	return c.tokens.map((tok, i) => {
		const len = [...tok.surface].length;
		while (chars.slice(at, at + len).join('') !== tok.surface) at++;
		const m: SegmentMatch = {
			surface: tok.surface,
			start: at,
			end: at + len,
			lemma: tok.lemma,
			reason: '',
			entries: [{ id: i + 1, kind: 'word' }],
			reading: { type: 'kana', value: tok.surface }
		};
		if ('function' in tok && tok.function) m.function = true;
		at += len;
		return m;
	});
}

describe('a reading lesson never shows a function word as unreached (segment/cases.json)', () => {
	it.each(fixture.cases)('$name', (c) => {
		const matches = matchesOf(c);
		const parts = readingParts(c.text, matches, new Set());
		expect(parts.map((p) => p.text).join('')).toBe(c.text);
		// Nothing is reached: every word but the function words gets a reading and a gloss.
		expect(unreachedEntries(parts).map((u) => u.entryId)).toEqual(matches.filter((m) => !m.function).map((m) => m.entries[0].id));
		for (const p of parts) {
			const m = matches.find((x) => x.entries[0].id === p.entryId);
			if (m?.function) expect(p.reading).toBeNull();
		}
	});
});
