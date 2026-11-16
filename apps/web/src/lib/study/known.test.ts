import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/frequency/known.json';
import { knownEntries } from './known';
import { MASTERY_THRESHOLD } from './mastery';
import type { Schedule } from './scheduler';
import type { StudyCard } from './types';

describe('knownEntries (frequency/known.json)', () => {
	it('uses the mastery threshold', () => {
		expect(fixture.threshold).toBe(MASTERY_THRESHOLD);
	});

	it.each(fixture.cases)('$name', (c) => {
		const schedules = c.schedules as Record<string, Schedule>;
		const known = knownEntries(c.cards as StudyCard[], (id) => schedules[id] ?? null);
		expect(c.entries.filter((id) => known.has(id))).toEqual(c.expectedKnown);
		expect([...known].sort((a, b) => a - b)).toEqual(c.expectedKnown);
	});

	it('nothing is known without cards', () => {
		expect(knownEntries([], () => null).size).toBe(0);
	});
});
