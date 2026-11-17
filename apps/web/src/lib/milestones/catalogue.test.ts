import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/milestones/catalogue.json';
import systemDeckIds from '../../../../../docs/contracts/decks/system-deck-ids.json';
import {
	FAMILIES,
	MILESTONE_KEY_PREFIX,
	compareIds,
	enabledFamilies,
	levelMilestoneId,
	milestoneId,
	parseMilestoneId,
	type MilestoneFamily
} from './catalogue';

type Case = (typeof fixture.cases)[number] & Record<string, unknown>;
const cases = fixture.cases as Case[];

describe('milestones/catalogue.json', () => {
	it('FAMILIES equals the catalogue (order, thresholds, flags)', () => {
		expect(FAMILIES.map(({ family, thresholds, unit, requires, hanOnly, source }) => ({
			family,
			thresholds: [...thresholds],
			unit,
			requires,
			hanOnly,
			source
		}))).toEqual(fixture.families);
		expect(MILESTONE_KEY_PREFIX).toBe(fixture.idGrammar.keyPrefix);
	});

	it.each(cases.filter((c) => c.op === 'id'))('id: $name', (c) => {
		const got =
			c.family === 'level-complete'
				? levelMilestoneId(c.packId as string, c.level as string)
				: milestoneId(c.family as Exclude<MilestoneFamily, 'level-complete'>, c.threshold as number);
		expect(got).toBe(c.expect);
	});

	it.each(cases.filter((c) => c.op === 'parse'))('parse: $name', (c) => {
		expect(parseMilestoneId(c.id as string)).toEqual(c.expect);
	});

	it.each(cases.filter((c) => c.op === 'enabled'))('enabled: $name', (c) => {
		const sw = c.switches as { flashcards: boolean; reader: boolean; journal: boolean };
		const got = enabledFamilies({ ...sw, han: c.han as boolean });
		// In catalogue order.
		expect(FAMILIES.map((f) => f.family).filter((f) => got.has(f))).toEqual(c.expect);
	});

	it.each(cases.filter((c) => c.op === 'order'))('order: $name', (c) => {
		expect([...(c.ids as string[])].sort(compareIds)).toEqual(c.expect);
	});
});

describe('catalogue', () => {
	it('every level id of the decks contract parses back to its deck id', () => {
		for (const d of systemDeckIds.cases) {
			if (d.kind !== 'level') continue;
			const id = levelMilestoneId(d.packId as string, d.level as string);
			expect(id).toBe(`level-complete:${d.id}`);
			expect(parseMilestoneId(id)).toEqual({ family: 'level-complete', deckId: d.id });
		}
	});

	it('every catalogue id round-trips', () => {
		for (const f of FAMILIES) {
			for (const n of f.thresholds) {
				const id = milestoneId(f.family as Exclude<MilestoneFamily, 'level-complete'>, n);
				expect(parseMilestoneId(id)).toEqual({ family: f.family, threshold: n });
			}
		}
	});

	it('unknown ids sort after known ones, by id', () => {
		expect(['zz:1', 'reviews:100', 'aa:2'].sort(compareIds)).toEqual(['reviews:100', 'aa:2', 'zz:1']);
	});

	it('milestoneId refuses a value that is not a threshold', () => {
		expect(() => milestoneId('reviews', 7)).toThrow();
	});
});
