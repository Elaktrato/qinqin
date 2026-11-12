import { describe, expect, it } from 'vitest';

import { buildLevelQueue, type LevelEntry } from './levelQueue';
import type { ReviewEvent, ReviewGrade, StudyCard } from './types';

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

function card(id: string, entryId: number, createdAt = '2026-01-01T00:00:00.000Z'): StudyCard {
	return { id, kind: 'vocab', entryId, deckIds: ['general'], createdAt };
}

function entry(id: number, kind = 'word'): LevelEntry {
	return { id, kind };
}

const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('buildLevelQueue', () => {
	it('returns an empty queue for empty inputs', () => {
		expect(
			buildLevelQueue({
				entries: [],
				cards: [],
				reviews: [],
				newLimit: 20,
				reviewLimit: 100,
				now: NOW
			})
		).toEqual([]);
	});

	it('reuses an existing card instead of creating a virtual item', () => {
		const queue = buildLevelQueue({
			entries: [entry(1)],
			cards: [card('c1', 1)],
			reviews: [review('c1', 3, '2026-01-01T00:00:00.000Z')],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([{ cardId: 'c1', entryId: 1, virtual: false }]);
	});

	it('creates stable virtual ids in level entry order', () => {
		const queue = buildLevelQueue({
			entries: [entry(7), entry(3), entry(12)],
			cards: [],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([
			{ cardId: 'level:7', entryId: 7, virtual: true },
			{ cardId: 'level:3', entryId: 3, virtual: true },
			{ cardId: 'level:12', entryId: 12, virtual: true }
		]);
	});

	it('puts due cards first, ordered by due, then virtual entries', () => {
		const queue = buildLevelQueue({
			entries: [entry(1), entry(2), entry(3), entry(4)],
			cards: [card('c2', 2), card('c1', 1)],
			reviews: [
				// c2 is due later than c1.
				review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
				review('c2', 3, '2026-02-01T00:00:00.000Z', eventId(2))
			],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.cardId)).toEqual(['c1', 'c2', 'level:3', 'level:4']);
	});

	it('orders equal due instants by entry id', () => {
		const queue = buildLevelQueue({
			entries: [entry(1), entry(2)],
			cards: [card('c2', 2), card('c1', 1)],
			reviews: [
				review('c2', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
				review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(2))
			],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.entryId)).toEqual([1, 2]);
	});

	it('leaves out cards that are reviewed but not due', () => {
		const queue = buildLevelQueue({
			entries: [entry(1), entry(2), entry(3)],
			cards: [card('c1', 1), card('c2', 2)],
			reviews: [
				review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
				// c2 was reviewed a minute ago, so it is neither due nor virtual.
				review('c2', 3, '2026-05-31T23:59:00.000Z', eventId(2))
			],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.cardId)).toEqual(['c1', 'level:3']);
	});

	it('includes an existing unreviewed card as new, with its real id', () => {
		const queue = buildLevelQueue({
			entries: [entry(1), entry(2)],
			cards: [card('c1', 1)],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([
			{ cardId: 'c1', entryId: 1, virtual: false },
			{ cardId: 'level:2', entryId: 2, virtual: true }
		]);
	});

	it('caps the combined new bucket, existing cards before virtual entries', () => {
		const queue = buildLevelQueue({
			entries: [entry(1), entry(2), entry(3), entry(4)],
			cards: [card('c3', 3), card('c2', 2)],
			reviews: [],
			newLimit: 2,
			reviewLimit: 100,
			now: NOW
		});

		// Existing never-reviewed cards sort by entry id and consume the
		// cap first; entry 1 and 4 stay out this session.
		expect(queue).toEqual([
			{ cardId: 'c2', entryId: 2, virtual: false },
			{ cardId: 'c3', entryId: 3, virtual: false }
		]);
	});

	it('orders the combined new bucket: existing by entry id, then virtual in level order', () => {
		const queue = buildLevelQueue({
			entries: [entry(4), entry(3), entry(2), entry(1)],
			cards: [card('c2', 2), card('c3', 3)],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.entryId)).toEqual([2, 3, 4, 1]);
	});

	it('caps due cards and virtual entries independently', () => {
		const queue = buildLevelQueue({
			entries: [entry(1), entry(2), entry(3), entry(4)],
			cards: [card('c1', 1), card('c2', 2)],
			reviews: [
				review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
				review('c2', 3, '2026-02-01T00:00:00.000Z', eventId(2))
			],
			newLimit: 1,
			reviewLimit: 1,
			now: NOW
		});

		expect(queue).toEqual([
			{ cardId: 'c1', entryId: 1, virtual: false },
			{ cardId: 'level:3', entryId: 3, virtual: true }
		]);
	});

	it('keeps virtual entries when the review cap is zero', () => {
		const queue = buildLevelQueue({
			entries: [entry(1), entry(2)],
			cards: [card('c1', 1)],
			reviews: [review('c1', 3, '2026-01-01T00:00:00.000Z')],
			newLimit: 20,
			reviewLimit: 0,
			now: NOW
		});

		expect(queue).toEqual([{ cardId: 'level:2', entryId: 2, virtual: true }]);
	});

	it('skips non-word entries', () => {
		const queue = buildLevelQueue({
			entries: [entry(1, 'character'), entry(2, 'word'), entry(3, 'sentence')],
			cards: [],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([{ cardId: 'level:2', entryId: 2, virtual: true }]);
	});

	it('skips a non-word entry even when a card matches it', () => {
		const queue = buildLevelQueue({
			entries: [entry(1, 'character')],
			cards: [card('c1', 1)],
			reviews: [review('c1', 3, '2026-01-01T00:00:00.000Z')],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([]);
	});

	it('dedupes repeated entries and keeps the first occurrence', () => {
		const queue = buildLevelQueue({
			entries: [entry(5), entry(3), entry(5)],
			cards: [],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([
			{ cardId: 'level:5', entryId: 5, virtual: true },
			{ cardId: 'level:3', entryId: 3, virtual: true }
		]);
	});

	it('does not mark a card due from reviews of other cards', () => {
		const queue = buildLevelQueue({
			entries: [entry(1)],
			cards: [card('c1', 1)],
			reviews: [review('other', 3, '2026-01-01T00:00:00.000Z')],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		// Still unreviewed as far as its own history goes, so it is new.
		expect(queue).toEqual([{ cardId: 'c1', entryId: 1, virtual: false }]);
	});
});
