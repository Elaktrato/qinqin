import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../docs/contracts/reader/smart-readings.json';
import { cardScore, MASTERY_THRESHOLD } from '$lib/study/mastery';
import type { Schedule } from '$lib/study/scheduler';
import type { StudyCard } from '$lib/study/types';
import type { SegmentMatch } from '$lib/api/types';
import { knownIndex, type KnownIndex } from '$lib/study/known';
import { annotateParagraph, isKnown } from './smartReadings';

describe('the score the rule uses', () => {
	it('is the decks view cardScore and threshold', () => {
		expect(MASTERY_THRESHOLD).toBe(fixture.masteryThreshold);
		for (const c of fixture.scoreCases) expect(cardScore(c.stability)).toBe(c.score);
	});
});

describe('knownIndex scores (contract)', () => {
	for (const c of fixture.indexCases) {
		it(c.name, () => {
			const cards = c.cards.map((x) => ({ id: x.id, kind: x.kind, entryId: x.entryId }) as StudyCard);
			const schedules = new Map<string, Schedule>();
			for (const x of c.cards) {
				if (x.stability !== null) schedules.set(x.id, { due: '', stability: x.stability, difficulty: 5, state: 2 });
			}
			const got = knownIndex(cards, (id) => schedules.get(id) ?? null).scores;
			expect(Object.fromEntries(got)).toEqual(Object.fromEntries(Object.entries(c.expect).map(([k, v]) => [Number(k), v])));
		});
	}
});

function toMatch(m: (typeof fixture.cases)[number]['matches'][number]): SegmentMatch {
	return {
		surface: m.surface,
		start: m.start,
		end: m.end,
		lemma: m.lemma,
		...('stem' in m && m.stem ? { stem: m.stem } : {}),
		reason: '',
		entries: m.entries.map((id) => ({ id, kind: 'word' as const })),
		...(m.reading ? { reading: m.reading } : {})
	};
}

describe('annotateParagraph (contract)', () => {
	for (const c of fixture.cases) {
		it(c.name, () => {
			const index: KnownIndex = {
				scores: new Map(Object.entries(c.scores).map(([k, v]) => [Number(k), v as number])),
				carded: new Set(),
				marks: new Set('marks' in c ? (c.marks as number[]) : [])
			};
			const got = annotateParagraph(
				c.runs,
				c.matches.map(toMatch),
				index,
				{ bookRuby: c.bookRuby, readings: c.readings as 'never', smartThreshold: c.smartThreshold, rubyScale: 0.55, font: 'default', highlightWords: false },
				c.lang
			);
			expect(got).toEqual(c.expect);
		});
	}
});

describe('isKnown', () => {
	const match = toMatch({ start: 0, end: 1, surface: 'a', lemma: 'a', reading: null as never, entries: [4, 5] });
	const idx = (scores: [number, number][], marks: number[] = []): KnownIndex => ({
		scores: new Map(scores),
		carded: new Set(scores.map(([id]) => id)),
		marks: new Set(marks)
	});
	it('looks at the first entry only', () => {
		expect(isKnown(match, idx([[5, 99]]), 80)).toBe(false);
		expect(isKnown(match, idx([[4, 80]]), 80)).toBe(true);
	});
	it('a mark on the first entry makes it known, whatever the threshold', () => {
		expect(isKnown(match, idx([], [4]), 100)).toBe(true);
		expect(isKnown(match, idx([], [5]), 10)).toBe(false);
	});
});
