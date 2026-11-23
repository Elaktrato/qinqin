import { describe, expect, it } from 'vitest';

import fixture from '../../../../../docs/contracts/cards/session-queue.json';
import { NO_LIMIT, type Candidate, type DayCounts, type LimitPair } from './limits';
import {
	admitSession,
	backfillLimit,
	buildSessionQueue,
	sessionBackfill,
	skipKindsByEntry,
	type QueueContext
} from './sessionQueue';
import type { StudyCard } from './types';

const EMPTY: DayCounts = { newDone: new Map(), reviewDone: new Map(), reviewedToday: new Set(), firstDay: new Map() };

function ctx(over: Partial<QueueContext['limits']> = {}, vacationToday = false): QueueContext {
	return { vacationToday, limits: { workspace: null, decks: {}, existingDecks: null, ...over } };
}

const cand = (cardId: string, bucket: Candidate['bucket'], deckIds = ['general']): Candidate => ({
	cardId,
	deckIds,
	bucket
});

describe('admitSession', () => {
	it('admits through the session caps; the allowance has no new cap', () => {
		const out = admitSession({
			candidates: [cand('r1', 'review'), cand('n1', 'new'), cand('n2', 'new')],
			ctx: ctx(),
			counts: EMPTY,
			caps: { newLimit: 1, reviewLimit: 5 }
		});
		expect([...out.inSession]).toEqual(['r1', 'n1']);
		expect([...out.inAllowance]).toEqual(['r1', 'n1', 'n2']);
	});

	it('Study all ignores the caps and every daily limit, the defaults included', () => {
		const candidates = Array.from({ length: 25 }, (_, i) => cand(`n${i}`, 'new'));
		const limited = { newLimit: 0, reviewLimit: 0 };
		expect(admitSession({ candidates, ctx: ctx(), counts: EMPTY, caps: limited }).inSession.size).toBe(0);
		const all = admitSession({ candidates, ctx: ctx(), counts: EMPTY, caps: limited, studyAll: true });
		expect(all.inSession.size).toBe(25);
		expect(all.left.unlimited).toBe(true);
	});

	it('admits nothing on a vacation day', () => {
		const out = admitSession({
			candidates: [cand('c1', 'continuing'), cand('n1', 'new')],
			ctx: ctx({}, true),
			counts: EMPTY,
			caps: { newLimit: 5, reviewLimit: 5 },
			studyAll: true
		});
		expect(out.inSession.size + out.inAllowance.size).toBe(0);
		expect(out.left).toEqual({ reviews: 0, new: 0, unlimited: false, limitedOut: 0 });
	});
});

describe('buildSessionQueue', () => {
	const entries = ['a', 'b', 'c', 'd'].map((id) => ({ ...cand(id, 'new'), item: { id } }));

	it('returns the items, not the ids, in candidate order', () => {
		const plan = buildSessionQueue({ entries, ctx: ctx(), counts: EMPTY, caps: { newLimit: 2, reviewLimit: 0 } });
		expect(plan.queue).toEqual([{ id: 'a' }, { id: 'b' }]);
		expect(plan.reserve).toEqual([{ id: 'c' }, { id: 'd' }]);
		expect(plan.backfillLeft).toBe(30);
	});
});

describe('sessionBackfill', () => {
	it('is backfillLimit, or NO_LIMIT for Study all', () => {
		expect(sessionBackfill(10, false)).toBe(30);
		expect(sessionBackfill(25.5, false)).toBe(50);
		expect(sessionBackfill(Number.NaN, false)).toBe(30);
		expect(sessionBackfill(10, true)).toBe(NO_LIMIT);
		expect(backfillLimit(-4)).toBe(30);
	});
});

describe('skipKindsByEntry', () => {
	it("unions each word's removed kinds from its vocab rows", () => {
		const card = (id: string, kind: StudyCard['kind'], skipKinds?: StudyCard['skipKinds']): StudyCard => ({
			id,
			kind,
			entryId: 1,
			deckIds: ['general'],
			createdAt: '2026-01-01T00:00:00Z',
			...(skipKinds === undefined ? {} : { skipKinds })
		});
		const out = skipKindsByEntry([card('a', 'vocab', ['writing']), card('b', 'vocab', ['tone']), card('c', 'writing', ['sentence'])]);
		expect([...(out.get(1) ?? [])].sort()).toEqual(['tone', 'writing']);
	});
});

interface FixtureLimits {
	workspace: Partial<LimitPair> | null;
	decks: Record<string, Partial<LimitPair>>;
	existingDecks: string[] | null;
}

describe('docs/contracts/cards/session-queue.json', () => {
	it('is the session-queue rule', () => {
		expect(fixture.rule).toBe('cards/session-queue');
		expect(fixture.noLimit).toBe(NO_LIMIT);
		expect(fixture.cases.length).toBeGreaterThan(10);
	});

	it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
		const limits = c.limits as FixtureLimits;
		const counts: DayCounts = {
			...EMPTY,
			newDone: new Map(Object.entries(c.counts.newDone as Record<string, number>)),
			reviewDone: new Map(Object.entries(c.counts.reviewDone as Record<string, number>)),
			reviewedToday: new Set(c.candidates.filter((x) => x.bucket === 'continuing').map((x) => x.cardId))
		};
		const queueCtx: QueueContext = {
			vacationToday: c.vacationToday,
			limits: {
				workspace: limits.workspace,
				decks: limits.decks,
				existingDecks: limits.existingDecks === null ? null : new Set(limits.existingDecks)
			}
		};
		const candidates = c.candidates as Candidate[];
		const input = { ctx: queueCtx, counts, caps: c.caps, studyAll: c.studyAll };
		const admission = admitSession({ ...input, candidates });
		expect([...admission.inSession]).toEqual(c.expect.queue);
		expect([...admission.inAllowance]).toEqual(c.expect.inAllowance);
		expect(admission.left).toEqual(c.expect.left);
		const plan = buildSessionQueue({ ...input, entries: candidates.map((x) => ({ ...x, item: x.cardId })) });
		expect(plan.queue).toEqual(c.expect.queue);
		expect(plan.reserve).toEqual(c.expect.reserve);
		expect(plan.backfillLeft).toBe(c.expect.backfillLeft);
	});
});
