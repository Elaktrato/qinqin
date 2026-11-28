import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../docs/contracts/segment/cases.json';
import type { SegmentMatch } from '$lib/api/types';
import { EMPTY_KNOWN_INDEX } from '$lib/studycore/known';
import { tallyChapter } from './coverage';
import { wordRanges } from './wordRanges';

// The fixture's tokens as /api/segment sends them: offsets found in the text
// in order, one entry per token, `function` only when true.
function matchesOf(c: (typeof fixture.cases)[number]): SegmentMatch[] {
	const chars = [...c.text];
	let at = 0;
	return c.tokens.map((tok, i) => {
		const len = [...tok.surface].length;
		while (chars.slice(at, at + len).join('') !== tok.surface) at++;
		const m: SegmentMatch = { surface: tok.surface, start: at, end: at + len, lemma: tok.lemma, reason: '', entries: [{ id: i + 1, kind: 'word' }] };
		if ('function' in tok && tok.function) m.function = true;
		at += len;
		return m;
	});
}

describe('function words are never new (segment/cases.json)', () => {
	it.each(fixture.cases)('$name', (c) => {
		const matches = matchesOf(c);
		const content = matches.filter((m) => !m.function);
		// The reader draws no word state on a function word, even with nothing known.
		expect(wordRanges(matches, EMPTY_KNOWN_INDEX, 80, 'ja').map((r) => r.start)).toEqual(content.map((m) => m.start));
		// Coverage counts only the other words as tokens and types.
		const tally = tallyChapter(1, 'ja', [c.text], new Map([[0, matches]]));
		expect(tally.tokens).toBe(content.length);
		expect([...tally.types.keys()].sort((a, b) => a - b)).toEqual(content.map((m) => m.entries[0].id));
	});

	it('the fixture has function words', () => {
		expect(fixture.cases.some((c) => c.tokens.some((t) => 'function' in t && t.function))).toBe(true);
	});
});
