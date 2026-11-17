import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { studyDay } from '../time/studyDay';
import { describe, expect, it, vi } from 'vitest';

import type { ReviewEvent, ReviewGrade, StudyCard } from './types';
import { createEmptyCard, fsrs, generatorParameters, Rating, type Grade } from 'ts-fsrs';

// A passthrough spy: the options scheduler.ts hands to ts-fsrs are part of the FSRS pin.
vi.mock('ts-fsrs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ts-fsrs')>();
	return { ...actual, fsrs: vi.fn(actual.fsrs) };
});

import envelopeFixture from '../../../../../docs/contracts/events/envelope.json';
import vacationSchedule from '../../../../../docs/contracts/scheduler/vacation-schedule.json';
import { DEFAULT_W } from './fsrs/params';
import { clockFromRuns, IDENTITY_CLOCK } from './studyClock';
import { UTC_CONTEXT, type StudyContext } from './studyContext';
import {
	buildQueue,
	isDue,
	isValidReview,
	levelFromXp,
	scheduleFor,
	scheduleTimeline,
	schedulerCacheSize,
	sortedReviews,
	xpFromReviews
} from './scheduler';

// Read with JSON.parse, not imported: a JSON import turns 1e999 into null, the
// fixture means Infinity (what JSON.parse makes of a stored 1e999).
const fsrsFixture: unknown = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/scheduler/fsrs.json'), 'utf8')
);
const reviewParseFixture: unknown = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/events/review-parse.json'), 'utf8')
);

// ULIDs are lexicographically sortable: same-instant reviews break ties
// on the id, exactly like the server's own ordering.
function eventId(n: number): string {
	return `01JTEST${String(n).padStart(19, '0')}`;
}

function review(
	cardId: string,
	grade: ReviewGrade,
	ts: string,
	id = eventId(1)
): ReviewEvent {
	return {
		id,
		workspaceId: 7,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	};
}

function card(id: string, deckIds: string[] = ['general'], createdAt = '2026-01-01T00:00:00.000Z'): StudyCard {
	return { id, kind: 'vocab', entryId: 1, deckIds, createdAt };
}

// Event rows are only validated for id/ts server-side, so a payload can
// still be out of contract when it reaches the scheduler.
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

describe('scheduleFor', () => {
	it('returns null when the card has no reviews', () => {
		expect(scheduleFor('missing', [], NOW, DEFAULT_W, IDENTITY_CLOCK)).toBeNull();
		expect(scheduleFor('missing', [review('other', 3, '2026-01-01T00:00:00.000Z')], NOW, DEFAULT_W, IDENTITY_CLOCK)).toBeNull();
	});

	it('replays the same events to the same schedule', () => {
		const reviews = [
			review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
			review('c1', 4, '2026-01-02T00:00:00.000Z', eventId(2)),
			review('c1', 3, '2026-02-01T00:00:00.000Z', eventId(3))
		];

		const first = scheduleFor('c1', reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
		const second = scheduleFor('c1', [...reviews].reverse(), NOW, DEFAULT_W, IDENTITY_CLOCK);

		expect(first).not.toBeNull();
		expect(second).toEqual(first);
	});

	it('sorts by ts then id, independent of array order', () => {
		const a = review('c1', 3, '2026-01-02T00:00:00.000Z', eventId(1));
		const b = review('c1', 1, '2026-01-02T00:00:00.000Z', eventId(2));

		// Same instant: the id decides which grade is applied last.
		expect(scheduleFor('c1', [a, b], NOW, DEFAULT_W, IDENTITY_CLOCK)).toEqual(scheduleFor('c1', [b, a], NOW, DEFAULT_W, IDENTITY_CLOCK));
	});

	it('ignores reviews of other cards', () => {
		const own = [review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1))];
		const other = [
			...own,
			review('c2', 1, '2026-01-01T00:00:00.000Z', eventId(2)),
			review('c2', 1, '2026-01-02T00:00:00.000Z', eventId(3))
		];

		expect(scheduleFor('c1', other, NOW, DEFAULT_W, IDENTITY_CLOCK)).toEqual(scheduleFor('c1', own, NOW, DEFAULT_W, IDENTITY_CLOCK));
	});

	it('makes Again due earlier than Good for the same history', () => {
		const history = [review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1))];
		const again = scheduleFor(
			'c1',
			[...history, review('c1', 1, '2026-01-02T00:00:00.000Z', eventId(2))],
			NOW
		, DEFAULT_W, IDENTITY_CLOCK);
		const good = scheduleFor(
			'c1',
			[...history, review('c1', 3, '2026-01-02T00:00:00.000Z', eventId(2))],
			NOW
		, DEFAULT_W, IDENTITY_CLOCK);

		expect(again).not.toBeNull();
		expect(good).not.toBeNull();
		expect(new Date(again!.due).getTime()).toBeLessThan(new Date(good!.due).getTime());
	});

	it('exposes the fsrs memory state and a due instant', () => {
		const schedule = scheduleFor(
			'c1',
			[review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1))],
			NOW
		, DEFAULT_W, IDENTITY_CLOCK);

		expect(schedule).not.toBeNull();
		expect(new Date(schedule!.due).toISOString()).toBe(schedule!.due);
		expect(typeof schedule!.stability).toBe('number');
		expect(typeof schedule!.difficulty).toBe('number');
		expect(typeof schedule!.state).toBe('number');
	});
});

describe('isDue', () => {
	it('compares the due instant with now', () => {
		const schedule = { due: '2026-06-01T00:00:00.000Z', stability: 1, difficulty: 1, state: 2 };

		expect(isDue(schedule, new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
		expect(isDue(schedule, new Date('2026-06-01T00:00:01.000Z'))).toBe(true);
		expect(isDue(schedule, new Date('2026-05-31T23:59:59.000Z'))).toBe(false);
	});
});

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

const UTC_DAY = studyDay([]);

describe('xpFromReviews', () => {
	it('awards 10 plus the grade bonus per review', () => {
		const reviews = [
			review('c1', 1, '2026-01-01T00:00:00.000Z', eventId(1)),
			review('c1', 2, '2026-01-02T00:00:00.000Z', eventId(2)),
			review('c2', 3, '2026-01-03T00:00:00.000Z', eventId(3)),
			review('c2', 4, '2026-01-04T00:00:00.000Z', eventId(4))
		];

		// again 10, hard 10, good 15, easy 20, plus +10 first review of
		// each of the four distinct UTC days
		expect(xpFromReviews(reviews, UTC_DAY.dayOf)).toBe(95);
	});

	it('is zero for no reviews', () => {
		expect(xpFromReviews([], UTC_DAY.dayOf)).toBe(0);
	});
});

describe('levelFromXp', () => {
	it('needs 100 * level xp per level starting at 1', () => {
		expect(levelFromXp(0)).toBe(1);
		expect(levelFromXp(99)).toBe(1);
		expect(levelFromXp(100)).toBe(2);
		expect(levelFromXp(250)).toBe(2);
		expect(levelFromXp(300)).toBe(3);
	});
});

describe('malformed review events', () => {
	it('ignores an out-of-range grade for scheduling and xp', () => {
		const valid = review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1));
		const poisoned = malformed('c1', 9, '2026-01-02T00:00:00.000Z');

		expect(scheduleFor('c1', [valid, poisoned], NOW, DEFAULT_W, IDENTITY_CLOCK)).toEqual(scheduleFor('c1', [valid], NOW, DEFAULT_W, IDENTITY_CLOCK));
		expect(xpFromReviews([valid, poisoned], UTC_DAY.dayOf)).toBe(25);
	});

	it('ignores an invalid timestamp and an empty card id', () => {
		expect(scheduleFor('c1', [malformed('c1', 3, 'not-a-timestamp')], NOW, DEFAULT_W, IDENTITY_CLOCK)).toBeNull();
		expect(scheduleFor('c1', [malformed('', 3, '2026-01-01T00:00:00.000Z')], NOW, DEFAULT_W, IDENTITY_CLOCK)).toBeNull();
	});

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

describe('scheduleFor weights', () => {
	const reviews = [
		review('w1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
		review('w1', 3, '2026-01-04T00:00:00.000Z', eventId(2)),
		review('w1', 4, '2026-01-12T00:00:00.000Z', eventId(3))
	];

	it('with the default weights equals a plain ts-fsrs replay', () => {
		const plain = fsrs();
		let c = createEmptyCard(new Date(reviews[0].ts));
		const grades: Grade[] = [Rating.Good, Rating.Good, Rating.Easy];
		reviews.forEach((r, i) => {
			c = plain.next(c, new Date(r.ts), grades[i]).card;
		});
		const got = scheduleFor('w1', reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(got?.due).toBe(c.due.toISOString());
		expect(got?.stability).toBe(c.stability);
		expect(got?.difficulty).toBe(c.difficulty);
	});

	it('a doubled w8 makes the due date later', () => {
		const w = [...DEFAULT_W];
		w[8] *= 2;
		const base = scheduleFor('w1', reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
		const changed = scheduleFor('w1', reviews, NOW, w, IDENTITY_CLOCK);
		expect(Date.parse(changed?.due ?? '')).toBeGreaterThan(Date.parse(base?.due ?? ''));
	});

	it('equal weight arrays share one scheduler instance', () => {
		const w = [...DEFAULT_W];
		w[3] = 7.77;
		scheduleFor('w1', reviews, NOW, w, IDENTITY_CLOCK);
		const size = schedulerCacheSize();
		scheduleFor('w1', reviews, NOW, [...w], IDENTITY_CLOCK);
		expect(schedulerCacheSize()).toBe(size);
	});

	it('keeps at most 16 instances and drops the oldest first', () => {
		for (let i = 0; i < 20; i++) {
			const w = [...DEFAULT_W];
			w[3] = 5 + i * 0.01;
			scheduleFor('w1', reviews, NOW, w, IDENTITY_CLOCK);
		}
		expect(schedulerCacheSize()).toBeLessThanOrEqual(16);
		expect(schedulerCacheSize()).toBe(16);
		const size = schedulerCacheSize();
		const newest = [...DEFAULT_W];
		newest[3] = 5 + 19 * 0.01;
		scheduleFor('w1', reviews, NOW, newest, IDENTITY_CLOCK);
		expect(schedulerCacheSize()).toBe(size);
		const oldest = [...DEFAULT_W];
		oldest[3] = 5;
		scheduleFor('w1', reviews, NOW, oldest, IDENTITY_CLOCK);
		expect(schedulerCacheSize()).toBe(16);
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

describe('fixtures: replay on the study clock', () => {
	for (const c of vacationSchedule.cases) {
		it(c.name, () => {
			const clock = clockFromRuns(c.runs.map((r) => ({ a: Date.parse(r.a), n: r.n })));
			const events = c.reviews.map((r, i) => review('c1', r.grade as ReviewGrade, r.ts, eventId(i + 1)));
			const got = scheduleFor('c1', events, NOW, DEFAULT_W, clock);
			expect(Date.parse(got?.due ?? '')).toBe(Date.parse(c.expected.due));
			expect(got?.stability).toBeCloseTo(c.expected.stability, 8);
			expect(got?.difficulty).toBeCloseTo(c.expected.difficulty, 8);
			expect(got?.state).toBe(c.expected.state);
		});
	}
});

describe('identity clock golden', () => {
	it('equals a plain ts-fsrs replay over 2,000 reviews', () => {
		let seed = 7;
		const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
		const events: ReviewEvent[] = [];
		let at = Date.parse('2025-01-01T08:00:00Z');
		for (let i = 0; i < 2000; i++) {
			at += Math.floor(rnd() * 3 * 86_400_000) + 60_000;
			events.push(review(`c${i % 200}`, (1 + Math.floor(rnd() * 4)) as ReviewGrade, new Date(at).toISOString(), eventId(i)));
		}
		const f = fsrs();
		const rating = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy } as const;
		for (let c = 0; c < 200; c++) {
			const mine = events.filter((e) => e.payload.cardId === `c${c}`);
			let plain = createEmptyCard(new Date(mine[0].ts));
			for (const e of mine) plain = f.next(plain, new Date(e.ts), rating[e.payload.grade] as Grade).card;
			const got = scheduleFor(`c${c}`, events, NOW, DEFAULT_W, IDENTITY_CLOCK);
			expect(got?.due).toBe(plain.due.toISOString());
			expect(got?.stability).toBe(plain.stability);
			expect(got?.difficulty).toBe(plain.difficulty);
		}
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

describe('docs/contracts/events/envelope.json: replay order', () => {
	interface EnvelopeEvent {
		id: string;
		ts: string;
		type: string;
		payload: unknown;
	}
	interface EnvelopeCase {
		name: string;
		steps: { post?: { events?: EnvelopeEvent[] }; list?: string; expect: { ids?: string[] } }[];
		stored: EnvelopeEvent[];
	}
	const order = (envelopeFixture as unknown as { cases: EnvelopeCase[] }).cases.find((c) => c.name.startsWith('list order'));
	it('sortedReviews over the stored copies equals the server list order (ts, then id)', () => {
		expect(order).toBeDefined();
		const serverOrder = order!.steps.find((s) => s.list === '')!.expect.ids!;
		const stored = order!.stored.map((e) => ({ ...e, workspaceId: 7, device: 'web' }) as ReviewEvent);
		expect(sortedReviews(stored).map((e) => e.id)).toEqual(serverOrder);
		expect(sortedReviews([...stored].reverse()).map((e) => e.id)).toEqual(serverOrder);
	});
});

describe('docs/contracts/events/review-parse.json: validity and replay order', () => {
	const fixture = reviewParseFixture as unknown as {
		cases: { name: string; event: ReviewEvent; valid: boolean }[];
		order: { name: string; events: { id: string; ts: string }[]; expect: string[] }[];
	};
	for (const c of fixture.cases) {
		it(`isValidReview: ${c.name}`, () => {
			expect(isValidReview(c.event)).toBe(c.valid);
		});
	}
	for (const c of fixture.order) {
		it(`sortedReviews: ${c.name}`, () => {
			const events = c.events.map((e) => review('c1', 3, e.ts, e.id));
			expect(sortedReviews(events).map((e) => e.id)).toEqual(c.expect);
			expect(sortedReviews([...events].reverse()).map((e) => e.id)).toEqual(c.expect);
		});
	}
});

describe('docs/contracts/scheduler/fsrs.json: the FSRS pin', () => {
	interface Point {
		due: string;
		stability: number;
		difficulty: number;
		state: number;
	}
	const fixture = fsrsFixture as {
		tsFsrs: string;
		parameters: Record<string, unknown> & { w: number[] };
		replay: {
			name: string;
			w: 'default' | number[];
			reviews: { id: string; ts: string; grade: ReviewGrade }[];
			order: string[];
			points: Point[];
		}[];
	};

	it('scheduler.ts passes only w to ts-fsrs, so every other option is the pinned default', () => {
		// A weight set no other test uses, so the scheduler cache builds a new instance.
		const w = [...fixture.parameters.w];
		w[0] = 0.2345;
		vi.mocked(fsrs).mockClear();
		scheduleFor('c1', [review('c1', 3, '2026-01-05T09:00:00Z')], new Date(0), w, IDENTITY_CLOCK);
		expect(vi.mocked(fsrs).mock.calls).toEqual([[{ w }]]);
		expect(generatorParameters({ w })).toEqual({ ...fixture.parameters, w });
		expect(generatorParameters()).toEqual(fixture.parameters);
	});
	it('records the installed ts-fsrs version', () => {
		const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../node_modules/ts-fsrs/package.json'), 'utf8'));
		expect(pkg.version).toBe(fixture.tsFsrs);
	});
	it('has at least 20 replay sequences', () => {
		expect(fixture.replay.length).toBeGreaterThanOrEqual(20);
	});
	it('the generated files equal the generator output (gen-scheduler-fixtures.mjs --check)', () => {
		// Catches a hand edit of any member, including those only a port reads (reps, lapses, scheduled_days, learning_steps).
		const script = resolve(__dirname, '../../../../../scripts/contracts/gen-scheduler-fixtures.mjs');
		const run = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
		expect(run.stderr).toBe('');
		expect(run.status).toBe(0);
	}, 30_000);
	for (const c of fixture.replay) {
		it(`replay: ${c.name}`, () => {
			const w = c.w === 'default' ? DEFAULT_W : c.w;
			const events = c.reviews.map((r) => review('c1', r.grade, r.ts, r.id));
			const timeline = scheduleTimeline('c1', events, w, IDENTITY_CLOCK);
			expect(timeline).toHaveLength(c.points.length);
			timeline.forEach((p, i) => {
				const want = c.points[i];
				expect(Date.parse(p.schedule.due), `due ${i}`).toBe(Date.parse(want.due));
				expect(p.schedule.stability).toBeCloseTo(want.stability, 8);
				expect(p.schedule.difficulty).toBeCloseTo(want.difficulty, 8);
				expect(p.schedule.state).toBe(want.state);
				expect(p.ts).toBe(Date.parse(c.reviews.find((r) => r.id === c.order[i])!.ts));
			});
		});
	}
});
