import { describe, expect, it } from 'vitest';

import type { ReviewEvent, ReviewGrade, StudyCard } from './types';
import { buildQueue, isDue, levelFromXp, scheduleFor, xpFromReviews } from './scheduler';

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
		expect(scheduleFor('missing', [], NOW)).toBeNull();
		expect(scheduleFor('missing', [review('other', 3, '2026-01-01T00:00:00.000Z')], NOW)).toBeNull();
	});

	it('replays the same events to the same schedule', () => {
		const reviews = [
			review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
			review('c1', 4, '2026-01-02T00:00:00.000Z', eventId(2)),
			review('c1', 3, '2026-02-01T00:00:00.000Z', eventId(3))
		];

		const first = scheduleFor('c1', reviews, NOW);
		const second = scheduleFor('c1', [...reviews].reverse(), NOW);

		expect(first).not.toBeNull();
		expect(second).toEqual(first);
	});

	it('sorts by ts then id, independent of array order', () => {
		const a = review('c1', 3, '2026-01-02T00:00:00.000Z', eventId(1));
		const b = review('c1', 1, '2026-01-02T00:00:00.000Z', eventId(2));

		// Same instant: the id decides which grade is applied last.
		expect(scheduleFor('c1', [a, b], NOW)).toEqual(scheduleFor('c1', [b, a], NOW));
	});

	it('ignores reviews of other cards', () => {
		const own = [review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1))];
		const other = [
			...own,
			review('c2', 1, '2026-01-01T00:00:00.000Z', eventId(2)),
			review('c2', 1, '2026-01-02T00:00:00.000Z', eventId(3))
		];

		expect(scheduleFor('c1', other, NOW)).toEqual(scheduleFor('c1', own, NOW));
	});

	it('makes Again due earlier than Good for the same history', () => {
		const history = [review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1))];
		const again = scheduleFor(
			'c1',
			[...history, review('c1', 1, '2026-01-02T00:00:00.000Z', eventId(2))],
			NOW
		);
		const good = scheduleFor(
			'c1',
			[...history, review('c1', 3, '2026-01-02T00:00:00.000Z', eventId(2))],
			NOW
		);

		expect(again).not.toBeNull();
		expect(good).not.toBeNull();
		expect(new Date(again!.due).getTime()).toBeLessThan(new Date(good!.due).getTime());
	});

	it('exposes the fsrs memory state and a due instant', () => {
		const schedule = scheduleFor(
			'c1',
			[review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1))],
			NOW
		);

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
		const queue = buildQueue({
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
		const queue = buildQueue({
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
		const queue = buildQueue({
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
		const queue = buildQueue({
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
		const queue = buildQueue({
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

describe('xpFromReviews', () => {
	it('awards 10 plus the grade bonus per review', () => {
		const reviews = [
			review('c1', 1, '2026-01-01T00:00:00.000Z', eventId(1)),
			review('c1', 2, '2026-01-02T00:00:00.000Z', eventId(2)),
			review('c2', 3, '2026-01-03T00:00:00.000Z', eventId(3)),
			review('c2', 4, '2026-01-04T00:00:00.000Z', eventId(4))
		];

		// again 10, hard 10, good 15, easy 20
		expect(xpFromReviews(reviews)).toBe(55);
	});

	it('is zero for no reviews', () => {
		expect(xpFromReviews([])).toBe(0);
	});
});

describe('levelFromXp', () => {
	it('maps 100 xp per level starting at 1', () => {
		expect(levelFromXp(0)).toBe(1);
		expect(levelFromXp(99)).toBe(1);
		expect(levelFromXp(100)).toBe(2);
		expect(levelFromXp(250)).toBe(3);
	});
});

describe('malformed review events', () => {
	it('ignores an out-of-range grade for scheduling and xp', () => {
		const valid = review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1));
		const poisoned = malformed('c1', 9, '2026-01-02T00:00:00.000Z');

		expect(scheduleFor('c1', [valid, poisoned], NOW)).toEqual(scheduleFor('c1', [valid], NOW));
		expect(xpFromReviews([valid, poisoned])).toBe(15);
	});

	it('ignores an invalid timestamp and an empty card id', () => {
		expect(scheduleFor('c1', [malformed('c1', 3, 'not-a-timestamp')], NOW)).toBeNull();
		expect(scheduleFor('c1', [malformed('', 3, '2026-01-01T00:00:00.000Z')], NOW)).toBeNull();
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
			queue = buildQueue({
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
