import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/frequency/known.json';
import { knownEntries, knownIndex } from './known';
import { MASTERY_THRESHOLD } from './mastery';
import type { Schedule } from './scheduler';
import type { StudyCard } from './types';

describe('knownEntries (frequency/known.json)', () => {
	it('uses the mastery threshold', () => {
		expect(fixture.threshold).toBe(MASTERY_THRESHOLD);
	});

	it.each(fixture.cases)('$name', (c) => {
		const schedules = c.schedules as Record<string, Schedule>;
		const marks = 'marks' in c ? (c.marks as number[]) : undefined;
		const known = knownEntries(c.cards as StudyCard[], (id) => schedules[id] ?? null, marks);
		expect(c.entries.filter((id) => known.has(id))).toEqual(c.expectedKnown);
		expect([...known].sort((a, b) => a - b)).toEqual(c.expectedKnown);
	});

	it('nothing is known without cards', () => {
		expect(knownEntries([], () => null).size).toBe(0);
	});

	it('without marks the result is the card rule alone', () => {
		const c = fixture.cases[0];
		const schedules = c.schedules as Record<string, Schedule>;
		const scheduleOf = (id: string) => schedules[id] ?? null;
		expect(knownEntries(c.cards as StudyCard[], scheduleOf, [])).toEqual(knownEntries(c.cards as StudyCard[], scheduleOf));
	});
});

describe('knownIndex', () => {
	const cards = [
		{ id: 'a', kind: 'vocab', entryId: 1 },
		{ id: 'b', kind: 'vocab', entryId: 1 },
		{ id: 'c', kind: 'writing', entryId: 2 },
		{ id: 'd', kind: 'vocab', entryId: 3 }
	] as StudyCard[];
	const stab: Record<string, number> = { a: 100, b: 200, c: 365 };
	const index = knownIndex(cards, (id) => (id in stab ? { stability: stab[id] } : null), [9]);

	it('scores the best reviewed vocab card per entry', () => {
		expect(Object.fromEntries(index.scores)).toEqual({ 1: 90 });
	});

	it('carded holds every entry with a live vocab card, reviewed or not', () => {
		expect([...index.carded].sort()).toEqual([1, 3]);
	});

	it('keeps the marks', () => {
		expect([...index.marks]).toEqual([9]);
	});
});
