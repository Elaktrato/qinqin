import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/milestones/catalogue.json';
import { FAMILIES } from './catalogue';
import { cardHeading, milestoneTitle, reachedOn, titleWithDay } from './milestoneText';

type Case = (typeof fixture.cases)[number] & Record<string, unknown>;

describe('milestones/catalogue.json: titles', () => {
	it.each((fixture.cases as Case[]).filter((c) => c.op === 'title'))('$name', (c) => {
		const levels = new Map(Object.entries((c.levels as Record<string, string> | undefined) ?? {}));
		expect(milestoneTitle(c.id as string, levels, 'en')).toBe(c.expect);
	});

	it('every family has a singular and a plural title in the fixture and here', () => {
		for (const f of FAMILIES) {
			const forms = (fixture.titles as Record<string, { one: string; other: string }>)[f.family];
			expect(forms, f.family).toBeDefined();
			if (f.family === 'level-complete') continue;
			const [first, second] = f.thresholds;
			expect(milestoneTitle(`${f.family}:${first}`, new Map(), 'en')).toBe(
				(first === 1 ? forms.one : forms.other).replace('{n}', String(first))
			);
			expect(milestoneTitle(`${f.family}:${second}`, new Map(), 'en')).toBe(forms.other.replace('{n}', String(second)));
		}
	});
});

describe('milestone texts', () => {
	it('groups thousands by the locale', () => {
		expect(milestoneTitle('reviews:100000', new Map(), 'en')).toBe('100,000 reviews');
		expect(milestoneTitle('reviews:100000', new Map(), 'de')).toBe('100.000 reviews');
	});

	it('card headings', () => {
		const r = { id: 'reviews:100', at: 0, day: '2026-11-03' };
		expect(cardHeading({ kind: 'recent', items: [r], ids: ['reviews:100'] })).toBe('Milestone reached');
		expect(cardHeading({ kind: 'recent', items: [r, r, r], ids: [] })).toBe('3 milestones reached');
		expect(cardHeading({ kind: 'summary', count: 14, named: [r], more: 11, ids: [] }, 'en')).toBe('You have reached 14 milestones');
		expect(cardHeading({ kind: 'summary', count: 1, named: [r], more: 0, ids: [] })).toBe('You have reached 1 milestone');
		expect(cardHeading({ kind: 'none' })).toBe('');
	});

	it('the reached date is the civil date, never shifted by the zone', () => {
		const original = process.env.TZ;
		for (const tz of ['Pacific/Kiritimati', 'America/Adak', 'UTC']) {
			process.env.TZ = tz;
			expect(reachedOn('2026-11-03', 'en-GB')).toBe('reached 3 November 2026');
			expect(reachedOn('2026-01-01', 'en-GB')).toBe('reached 1 January 2026');
		}
		process.env.TZ = original;
	});

	it('a history item reads as title and date', () => {
		expect(titleWithDay('1,000 reviews', '2026-11-03', 'en-GB')).toBe('1,000 reviews, reached 3 November 2026');
	});
});
