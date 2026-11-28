import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/reader/word-states.json';
import { EMPTY_KNOWN_INDEX, familiarity, isKnownEntry, type KnownIndex } from './known';
import { MASTERY_THRESHOLD } from './mastery';

function indexOf(c: (typeof fixture.cases)[number]): KnownIndex {
	return {
		scores: new Map(Object.entries(c.scores).map(([k, v]) => [Number(k), v as number])),
		carded: new Set(c.carded),
		marks: new Set(c.marks)
	};
}

describe('familiarity (reader/word-states.json)', () => {
	it('uses the mastery threshold by default', () => {
		expect(fixture.threshold).toBe(MASTERY_THRESHOLD);
	});

	it.each(fixture.cases)('$name', (c) => {
		const first = c.entries[0];
		const got = first === undefined ? 'new' : familiarity(first, indexOf(c), c.threshold);
		expect(got).toBe(c.expect);
		if (first !== undefined) expect(isKnownEntry(first, indexOf(c), c.threshold)).toBe(c.expect === 'known');
	});

	it('the default threshold is 80', () => {
		const index: KnownIndex = { scores: new Map([[1, 79], [2, 80]]), carded: new Set([1, 2]), marks: new Set() };
		expect(familiarity(1, index)).toBe('learning');
		expect(familiarity(2, index)).toBe('known');
	});

	it('the empty index knows nothing', () => {
		expect(familiarity(1, EMPTY_KNOWN_INDEX)).toBe('new');
	});
});
