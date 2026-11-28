// docs/contracts/tones/sandhi.json (#300): the spoken tones of a reading and the tone card's verdict.
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/tones/sandhi.json';
import { NUMERALS, ORDINAL_BEFORE, spokenTones, type SandhiSyllable } from './toneSandhi';
import { cleanReadings, parsePinyin, tonePadLabels, toneVerdict, type Tone } from './tones';

interface Case {
	name: string;
	written: string;
	numbered: string;
	pinyin: string;
	citation: Tone[];
	words?: number[];
	spoken: Tone[];
}

interface Grading {
	name: string;
	written: string;
	readings: string[];
	chosen: Tone[];
	gradeSpoken: boolean;
	expect: { correct: boolean; wrong: number; marks: boolean[]; spoken: Tone[] | null };
}

/** The syllables of a reading with their characters, as the tone card has them. */
function syllablesOf(written: string, pinyin: string): SandhiSyllable[] {
	const parsed = parsePinyin(pinyin);
	const chars = tonePadLabels(written, parsed.length);
	return parsed.map((s, i) => ({ char: chars?.[i] ?? null, plain: s.plain, tone: s.tone }));
}

describe('tones/sandhi fixture', () => {
	it('is the rule this module implements', () => {
		expect(fixture.rule).toBe('tones/sandhi');
		expect([...NUMERALS]).toEqual(fixture.numerals);
		expect([...ORDINAL_BEFORE]).toEqual(fixture.ordinalBefore);
	});

	it.each(fixture.cases as Case[])('$name', (c) => {
		const syllables = syllablesOf(c.written, c.pinyin);
		expect(syllables.map((s) => s.tone)).toEqual(c.citation);
		expect(spokenTones(syllables, c.words)).toEqual(c.spoken);
	});
});

describe('tones/sandhi grading', () => {
	it.each(fixture.grading as Grading[])('$name', (g) => {
		const candidates = cleanReadings(g.readings);
		const chars = tonePadLabels(g.written, g.chosen.length);
		const verdict = toneVerdict(g.chosen, candidates, { chars, gradeSpoken: g.gradeSpoken });
		expect({ correct: verdict.correct, wrong: verdict.wrong, marks: verdict.marks, spoken: verdict.spoken }).toEqual(
			g.expect
		);
	});
});
