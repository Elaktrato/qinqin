import { describe, expect, it } from 'vitest';
import rowsFixture from '../../../../../docs/contracts/scheduler/limits-rows.json';
import fixture from '../../../../../docs/contracts/scheduler/daily-limits.json';
import { studyDay } from '$lib/time/studyDay';
import {
	DEFAULT_LIMITS,
	NO_LIMIT,
	admit,
	cap,
	dayCounts,
	effectiveLimits,
	type Candidate,
	type DayCounts,
	type LimitPair
} from './limits';
import { contextFor } from './studyContext';
import type { ReviewEvent, StudyCard } from './types';

describe('fixtures: limits (defaults and the effective pair)', () => {
	it('has the documented defaults', () => {
		expect(DEFAULT_LIMITS).toEqual(rowsFixture.defaults);
	});
	for (const c of rowsFixture.effective) {
		it(`effective: ${c.name}`, () => {
			expect(effectiveLimits(c.workspace as never, c.deck as never)).toEqual(c.effective);
		});
	}
});

function toCards(cards: { id: string; deckIds: string[] }[]): StudyCard[] {
	return cards.map((c, i) => ({ id: c.id, kind: 'vocab', entryId: i + 1, deckIds: c.deckIds, createdAt: '2026-01-01T00:00:00Z' }));
}
function toReviews(rs: { id: string; ts: string; cardId: string; grade: number }[]): ReviewEvent[] {
	return rs.map((r) => ({ id: r.id, workspaceId: 1, device: 'w', ts: r.ts, type: 'review', payload: { cardId: r.cardId, mode: 'vocab', grade: r.grade as 3 } }));
}
const asObj = (m: Map<string, number>) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : 1)));

describe('fixtures: day counts', () => {
	for (const c of fixture.counts) {
		it(c.name, () => {
			const ctx = contextFor(studyDay(c.zone === 'UTC' ? [] : [{ zone: c.zone, from: null }]), [], Date.parse(c.now));
			const got = dayCounts(toCards(c.cards), toReviews(c.reviews as never), ctx, new Date(c.now));
			expect(asObj(got.newDone)).toEqual(c.expect.newDone);
			expect(asObj(got.reviewDone)).toEqual(c.expect.reviewDone);
			expect([...got.reviewedToday].sort()).toEqual(c.expect.reviewedToday);
			expect(asObj(got.firstDay as never)).toEqual(c.expect.firstDay);
		});
	}
});

describe('fixtures: admission', () => {
	for (const c of fixture.admission) {
		it(c.name, () => {
			const counts: DayCounts = {
				newDone: new Map(Object.entries(c.counts.newDone)),
				reviewDone: new Map(Object.entries(c.counts.reviewDone)),
				reviewedToday: new Set(),
				firstDay: new Map()
			};
			const limits = c.limits as unknown as Record<string, LimitPair>;
			const result = admit(
				c.candidates as Candidate[],
				(id) => limits[id] ?? DEFAULT_LIMITS,
				counts,
				c.session,
				new Set(c.existingDecks)
			);
			expect(result.admitted).toEqual(c.admitted);
			expect(result.left).toEqual(c.left);
		});
	}
});

describe('cap and NO_LIMIT (#175)', () => {
	it('floors a finite limit at zero or more', () => {
		expect(cap(5.9)).toBe(5);
		expect(cap(0)).toBe(0);
		expect(cap(-3)).toBe(0);
	});

	it('reads a non-finite limit as zero', () => {
		expect(cap(Number.NaN)).toBe(0);
		expect(cap(Infinity)).toBe(0);
		expect(cap(-Infinity)).toBe(0);
	});

	it('NO_LIMIT is one million and survives cap', () => {
		expect(NO_LIMIT).toBe(1_000_000);
		expect(cap(NO_LIMIT)).toBe(NO_LIMIT);
	});
});
