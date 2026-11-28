import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../docs/contracts/counters/items.json';
import { COUNTERS_DRILL, MEASURE_WORDS_DRILL, READINGS_DRILL, parseEntryItem, parseReadingItem, readingItem, studiedNounIds, validItem } from './items';

describe('item keys (docs/contracts/counters/items.json)', () => {
	it('names the three drills', () => {
		expect(Object.keys(fixture.drills).sort()).toEqual([COUNTERS_DRILL, READINGS_DRILL, MEASURE_WORDS_DRILL].sort());
	});
	for (const c of fixture.cases) {
		it(c.name, () => {
			expect(validItem(c.drill, c.item)).toBe(c.valid);
			if (!c.valid) return;
			if (fixture.drills[c.drill as keyof typeof fixture.drills] === 'entry') expect(parseEntryItem(c.item)).toBe(c.entryId);
			else {
				expect(parseReadingItem(c.item)).toEqual({ counter: c.counter, number: c.number });
				expect(readingItem(c.counter as string, c.number as string)).toBe(c.item);
			}
		});
	}
});

describe('studiedNounIds', () => {
	const cards = [
		{ id: 'a', entryId: 1 },
		{ id: 'b', entryId: 2, entryKind: 'character' as const },
		{ id: 'c', entryId: 3 },
		{ id: 'd', entryId: 4 }
	];
	const review = (cardId: string, ts: string) => ({ ts, payload: { cardId } });
	const reviews = [review('c', '2026-11-02T00:00:00Z'), review('a', '2026-11-03T00:00:00Z'), review('b', '2026-11-01T00:00:00Z'), review('c', '2026-11-01T12:00:00Z')];

	it('is the reviewed cards first reviewed first; a never-reviewed card is left out', () => {
		expect(studiedNounIds({ cards, reviews } as never, true)).toEqual([2, 3, 1]);
	});
	it('leaves character cards out where they are not words (Japanese kanji)', () => {
		expect(studiedNounIds({ cards, reviews } as never, false)).toEqual([3, 1]);
	});
});
