// The queue builder (queue.ts): which cards one session holds, before the session mix orders them.
import { describe, expect, it } from 'vitest';

import type { ReviewEvent, ReviewGrade, StudyCard } from '$lib/studycore/types';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { IDENTITY_CLOCK } from '$lib/studycore/studyClock';
import { UTC_CONTEXT, type StudyContext } from '$lib/studycore/studyContext';
import { scheduleFor } from '$lib/studycore/scheduler';
import { buildQueue } from './queue';
import * as build from '$lib/testing/study';

const eventId = (n: number): string => build.eventId(n);

function review(cardId: string, grade: ReviewGrade, ts: string, id = eventId(1)): ReviewEvent {
	return build.review({ id, cardId, grade, ts, workspaceId: 7 });
}

function card(id: string, deckIds: string[] = ['general'], createdAt = '2026-01-01T00:00:00.000Z'): StudyCard {
	return build.card({ id, deckIds, createdAt });
}

// Event rows are only validated for id/ts server-side, so a payload can
// still be out of contract when it reaches the queue.
function malformed(cardId: string, grade: number, ts: string): ReviewEvent {
	return {
		id: eventId(9),
		workspaceId: 7,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	} as unknown as ReviewEvent;
}

const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('buildQueue', () => {
	// Due-first ordering: c1's last review is older than c2's, so both are
	// due and c1 sorts first. c5 was reviewed recently, so it is neither
	// due nor new. c6 lives in another deck.
	const reviews = [
		review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
		review('c2', 3, '2026-02-01T00:00:00.000Z', eventId(2)),
		review('c5', 3, '2026-05-31T23:59:00.000Z', eventId(3)),
		review('c6', 3, '2026-01-01T00:00:00.000Z', eventId(4))
	];
	const cards = [
		card('c2', ['general'], '2026-01-01T00:00:00.000Z'),
		card('c1', ['general'], '2026-01-01T00:00:00.000Z'),
		card('c5', ['general'], '2026-01-01T00:00:00.000Z'),
		card('c3', ['general'], '2026-01-02T00:00:00.000Z'),
		card('c4', ['general'], '2026-01-03T00:00:00.000Z'),
		card('c6', ['other'], '2026-01-01T00:00:00.000Z')
	];

	it('puts due reviews first, ordered by due, then new cards', () => {
		const queue = buildQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			cards,
			reviews,
			deckIds: ['general'],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
	});

	it('caps reviews and new cards independently', () => {
		const queue = buildQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			cards,
			reviews,
			deckIds: ['general'],
			newLimit: 1,
			reviewLimit: 1,
			now: NOW
		});

		expect(queue.map((item) => item.id)).toEqual(['c1', 'c3']);
	});

	it('never treats a reviewed card as new, even when it is not due', () => {
		const queue = buildQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			cards,
			reviews,
			deckIds: ['general'],
			newLimit: 20,
			reviewLimit: 0,
			now: NOW
		});

		expect(queue.map((item) => item.id)).toEqual(['c3', 'c4']);
	});

	it('only keeps cards that belong to one of the selected decks', () => {
		const queue = buildQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			cards,
			reviews,
			deckIds: ['other'],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.id)).toEqual(['c6']);
	});

	it('includes a card shared with a selected deck', () => {
		const shared = card('c7', ['general', 'deck-a'], '2026-01-04T00:00:00.000Z');
		const queue = buildQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			cards: [...cards, shared],
			reviews,
			deckIds: ['deck-a'],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.id)).toEqual(['c7']);
	});
});

describe('buildQueue kinds', () => {
	const kindCard = (id: string, kind: StudyCard['kind']): StudyCard => ({
		...card(id),
		kind
	});
	const cards = [
		kindCard('v-due', 'vocab'),
		kindCard('t-due', 'tone'),
		kindCard('v-new', 'vocab'),
		kindCard('t-new', 'tone'),
		kindCard('s-new', 'sentence')
	];
	const reviews = [
		review('v-due', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
		review('t-due', 3, '2026-01-01T00:00:00.000Z', eventId(2))
	];
	const base = { ctx: UTC_CONTEXT, cards, reviews, deckIds: ['general'], newLimit: 10, reviewLimit: 10, now: NOW, w: DEFAULT_W };

	it('returns only the requested kinds, due and new', () => {
		const ids = buildQueue({ ...base, kinds: ['tone'] }).map((c) => c.id);
		expect(ids).toEqual(['t-due', 't-new']);
	});

	it('defaults to every kind', () => {
		expect(buildQueue(base)).toHaveLength(5);
	});

	it('returns nothing for an empty kind list', () => {
		expect(buildQueue({ ...base, kinds: [] })).toEqual([]);
	});
});

describe('malformed review events in a queue', () => {
	it('does not throw while building a queue and treats cleaned cards as new', () => {
		const cards = [
			card('c1', ['general'], '2026-01-01T00:00:00.000Z'),
			card('c2', ['general'], '2026-01-02T00:00:00.000Z')
		];
		const reviews = [
			malformed('c1', 9, '2026-01-02T00:00:00.000Z'),
			malformed('c2', 3, 'garbage')
		];

		let queue: StudyCard[] = [];
		expect(() => {
			queue = buildQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
				cards,
				reviews,
				deckIds: ['general'],
				newLimit: 20,
				reviewLimit: 100,
				now: NOW
			});
		}).not.toThrow();
		expect(queue.map((item) => item.id)).toEqual(['c1', 'c2']);
	});
});

describe('buildQueue with a schedule lookup', () => {
	it('gives the same queue as replaying the history', () => {
		const cards = ['a', 'b', 'c', 'd'].map((id, i) =>
			card(id, ['general'], `2026-01-0${i + 1}T00:00:00.000Z`)
		);
		const reviews = [
			review('a', 1, '2026-01-05T00:00:00.000Z', eventId(1)),
			review('b', 3, '2026-02-20T00:00:00.000Z', eventId(2)),
			review('b', 3, '2026-02-25T00:00:00.000Z', eventId(3))
		];
		const now = new Date('2026-03-01T00:00:00.000Z');
		const options = { ctx: UTC_CONTEXT, cards, reviews, deckIds: ['general'], newLimit: 5, reviewLimit: 5, now, w: DEFAULT_W };
		const plain = buildQueue(options);
		const looked = buildQueue({
			...options,
			scheduleOf: (id) => scheduleFor(id, reviews, now, DEFAULT_W, IDENTITY_CLOCK)
		});
		expect(looked.map((c) => c.id)).toEqual(plain.map((c) => c.id));
	});
});

describe('buildQueue with daily limits', () => {
	const many = Array.from({ length: 30 }, (_, i) => card(`n${i}`, ['general'], `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`));
	const base = { reviews: [] as ReviewEvent[], deckIds: ['general'], newLimit: 50, reviewLimit: 50, now: new Date('2026-06-10T12:00:00Z'), w: DEFAULT_W };
	const ctxWith = (limits: Partial<{ new: number | null; reviews: number | null }> | null): StudyContext => ({
		...UTC_CONTEXT,
		limits: { workspace: limits, decks: {}, existingDecks: null }
	});

	it('applies the default 20 new a day over a larger session limit', () => {
		expect(buildQueue({ ...base, cards: many, ctx: UTC_CONTEXT })).toHaveLength(20);
	});

	it('counts what was started today: 3 new left give 3 new', () => {
		const started = many.slice(0, 17).map((c, i) => review(c.id, 3, '2026-06-10T08:00:00.000Z', eventId(100 + i)));
		const queue = buildQueue({ ...base, cards: many, reviews: started, ctx: UTC_CONTEXT });
		// 17 started today are learning (due in minutes: still due at 12:00), 3 new more.
		expect(queue.filter((c) => !started.some((r) => r.payload.cardId === c.id))).toHaveLength(3);
	});

	it('a deck limit of 0 new hides new cards of that deck only', () => {
		const ctx: StudyContext = { ...UTC_CONTEXT, limits: { workspace: null, decks: { d1: { new: 0 } }, existingDecks: null } };
		const cards = [card('a', ['d1']), card('b', ['general'])];
		expect(buildQueue({ ...base, deckIds: ['d1', 'general'], cards, ctx }).map((c) => c.id)).toEqual(['b']);
	});

	it('an earlier review is capped by the review allowance and a refused card does not stop later ones', () => {
		const old = [card('x', ['full']), card('y', ['general'])];
		const reviews = old.map((c, i) => review(c.id, 3, '2026-01-01T00:00:00.000Z', eventId(200 + i)));
		const ctx: StudyContext = { ...UTC_CONTEXT, limits: { workspace: null, decks: { full: { reviews: 0 } }, existingDecks: null } };
		expect(buildQueue({ ...base, deckIds: ['full', 'general'], cards: old, reviews, ctx }).map((c) => c.id)).toEqual(['y']);
	});

	it('continuing cards (reviewed today, due again) ignore the allowance but not the session cap', () => {
		const cards = [card('l1', ['general']), card('l2', ['general'])];
		const reviews = cards.map((c, i) => review(c.id, 1, '2026-06-10T11:00:00.000Z', eventId(300 + i)));
		const ctx = ctxWith({ new: 0, reviews: 0 });
		expect(buildQueue({ ...base, cards, reviews, ctx })).toHaveLength(2);
		expect(buildQueue({ ...base, cards, reviews, ctx, reviewLimit: 1 })).toHaveLength(1);
	});

	it('re-shows change nothing: only recorded reviews count', () => {
		const started = many.slice(0, 3).map((c, i) => review(c.id, 3, '2026-06-10T08:00:00.000Z', eventId(400 + i)));
		const a = buildQueue({ ...base, cards: many, reviews: started, ctx: UTC_CONTEXT });
		const b = buildQueue({ ...base, cards: many, reviews: started, ctx: UTC_CONTEXT });
		expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
	});

	it('is unlimited with null limits', () => {
		expect(buildQueue({ ...base, cards: many, ctx: ctxWith({ new: null }) })).toHaveLength(30);
	});
});

describe('buildQueue with a new-card key (#75)', () => {
	const newCard = (id: string, entryId: number, deckIds = ['general'], createdAt = '2026-01-01T00:00:00.000Z'): StudyCard => ({
		id,
		kind: 'vocab',
		entryId,
		deckIds,
		createdAt
	});
	const cards = [
		newCard('due', 9),
		newCard('a', 1, ['general'], '2026-01-02T00:00:00.000Z'),
		newCard('b', 2, ['general'], '2026-01-03T00:00:00.000Z'),
		newCard('c', 3, ['general'], '2026-01-04T00:00:00.000Z'),
		newCard('d', 4, ['general'], '2026-01-05T00:00:00.000Z')
	];
	const reviews = [review('due', 3, '2026-01-01T00:00:00.000Z', eventId(1))];
	const ranks: Record<number, number> = { 1: 900, 2: 40, 3: 5, 9: 1 };
	const newKey = (c: StudyCard) => ranks[c.entryId] ?? null;
	const base = { ctx: UTC_CONTEXT, w: DEFAULT_W, cards, reviews, deckIds: ['general'], reviewLimit: 100, now: NOW };

	it('takes the best-ranked new cards under the new limit; reviews stay first', () => {
		expect(buildQueue({ ...base, newLimit: 2, newKey }).map((c) => c.id)).toEqual(['due', 'c', 'b']);
		// Unranked cards follow in the order added.
		expect(buildQueue({ ...base, newLimit: 10, newKey }).map((c) => c.id)).toEqual(['due', 'c', 'b', 'a', 'd']);
	});

	it('without a key the order added is kept', () => {
		expect(buildQueue({ ...base, newLimit: 2 }).map((c) => c.id)).toEqual(['due', 'a', 'b']);
	});

	it('the daily limits still admit per deck', () => {
		const split = [
			newCard('x', 3, ['full'], '2026-01-02T00:00:00.000Z'),
			newCard('y', 1, ['open'], '2026-01-03T00:00:00.000Z'),
			newCard('z', 2, ['open'], '2026-01-04T00:00:00.000Z')
		];
		const ctx: StudyContext = { ...UTC_CONTEXT, limits: { workspace: null, decks: { full: { new: 0 } }, existingDecks: null } };
		const opts = { ...base, ctx, cards: split, reviews: [], deckIds: ['full', 'open'], newLimit: 1 };
		// x ranks best but its deck takes no new cards today: the next-ranked z of the open deck.
		expect(buildQueue({ ...opts, newKey }).map((c) => c.id)).toEqual(['z']);
		expect(buildQueue(opts).map((c) => c.id)).toEqual(['y']);
	});
});
