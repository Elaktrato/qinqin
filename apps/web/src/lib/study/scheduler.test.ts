import { UTC_CONTEXT } from '$lib/study/studyContext';
import { studyDay } from '../time/studyDay';
import { describe, expect, it } from 'vitest';

import type { ReviewEvent, ReviewGrade, StudyCard } from './types';
import { createEmptyCard, fsrs, Rating, type Grade } from 'ts-fsrs';

import vacationSchedule from '../../../../../docs/contracts/scheduler/vacation-schedule.json';
import { DEFAULT_W } from './fsrs/params';
import { clockFromRuns, IDENTITY_CLOCK } from './studyClock';
import {
	buildQueue,
	isDue,
	levelFromXp,
	scheduleFor,
	schedulerCacheSize,
	xpFromReviews
} from './scheduler';

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
