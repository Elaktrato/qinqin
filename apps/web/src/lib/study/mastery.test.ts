import { describe, expect, it } from 'vitest';

import { masteryForChar, masterySummary } from './mastery';
import type { ReviewEvent, ReviewGrade, StudyCard } from './types';

const DAY = 86_400_000;
const BASE = Date.parse('2025-01-01T00:00:00.000Z');
const NOW = new Date('2026-06-01T00:00:00.000Z');

function eventId(n: number): string {
	return `01JMASTERY${String(n).padStart(17, '0')}`;
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

// The event log is only validated for id/ts server-side, so a stored
// payload can still be out of contract when it reaches mastery.
function malformedReview(cardId: string, grade: number, ts: string): ReviewEvent {
	return {
		id: eventId(9),
		workspaceId: 7,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	} as unknown as ReviewEvent;
}

function card(id: string, written?: string): StudyCard {
	const result: StudyCard = {
		id,
		kind: 'vocab',
		entryId: 1,
		deckIds: ['general'],
		createdAt: '2025-01-01T00:00:00.000Z'
	};
	if (written !== undefined) result.written = written;
	return result;
}

// Grades Good at increasing day offsets, as a learner answering at the
// FSRS due dates would. Offsets [0,1,11,41] climb steadily.
function goodHistory(cardId: string, offsets: number[]): ReviewEvent[] {
	return offsets.map((days, index) =>
		review(cardId, 3, new Date(BASE + days * DAY).toISOString(), eventId(index + 1))
	);
}

describe('masteryForChar', () => {
	it('reports unknown when no card containing the character was reviewed', () => {
		const cards = [card('c1', '猫')];

		expect(masteryForChar('猫', cards, [], NOW)).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
		expect(masteryForChar('猫', cards, goodHistory('other', [0]), NOW)).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
	});

	it('gives a single Good review a low fresh score', () => {
		const result = masteryForChar('猫', [card('c1', '猫')], goodHistory('c1', [0]), NOW);

		expect(result.reviewedCards).toBe(1);
		expect(result.score).toBeGreaterThan(0);
		expect(result.score).toBeLessThan(25);
		expect(result.stage).toBe('fresh');
	});

	it('ranks a longer spaced history higher than a single review', () => {
		const short = masteryForChar('猫', [card('short', '猫')], goodHistory('short', [0]), NOW);
		const long = masteryForChar(
			'猫',
			[card('long', '猫')],
			goodHistory('long', [0, 1, 11, 41]),
			NOW
		);

		expect(long.score).toBeGreaterThan(short.score);
		expect(long.stage).toBe('learned');
	});

	it('derives the stage from the score band', () => {
		const cases: Array<{ offsets: number[]; stage: string }> = [
			{ offsets: [0], stage: 'fresh' },
			{ offsets: [0, 1], stage: 'learning' },
			{ offsets: [0, 1, 11], stage: 'mature' },
			{ offsets: [0, 1, 11, 41], stage: 'learned' }
		];

		for (const { offsets, stage } of cases) {
			const result = masteryForChar(
				'猫',
				[card(`c-${offsets.join('-')}`, '猫')],
				goodHistory(`c-${offsets.join('-')}`, offsets),
				NOW
			);
			expect(result.stage).toBe(stage);
		}
	});

	it('averages the mastery of every reviewed card containing the character', () => {
		const low = card('low', '猫');
		const high = card('high', '猫咪');
		const lowReviews = goodHistory('low', [0, 1]);
		const highReviews = goodHistory('high', [0, 1, 11, 41]);

		const lowOnly = masteryForChar('猫', [low], lowReviews, NOW);
		const highOnly = masteryForChar('猫', [high], highReviews, NOW);
		const both = masteryForChar('猫', [low, high], [...lowReviews, ...highReviews], NOW);

		expect(lowOnly.score).toBeLessThan(highOnly.score);
		expect(both.reviewedCards).toBe(2);
		expect(both.score).toBeGreaterThan(lowOnly.score);
		expect(both.score).toBeLessThan(highOnly.score);
		// The score is the rounded mean of the per-card scores; each card
		// score is itself rounded, so allow a point of rounding drift.
		expect(Math.abs(both.score - (lowOnly.score + highOnly.score) / 2)).toBeLessThanOrEqual(1);
	});

	it('gives two cards with the same history the same score as one', () => {
		const history = goodHistory('c1', [0, 1, 11]);
		const one = masteryForChar('猫', [card('c1', '猫')], history, NOW);
		const two = masteryForChar(
			'猫',
			[card('c1', '猫'), card('c2', '猫咪')],
			[...history, ...goodHistory('c2', [0, 1, 11])],
			NOW
		);

		expect(two.score).toBe(one.score);
		expect(two.stage).toBe(one.stage);
		expect(two.reviewedCards).toBe(2);
	});

	it('never counts an unreviewed card towards the average', () => {
		const reviewed = card('reviewed', '猫');
		const unreviewed = card('unreviewed', '猫');
		const history = goodHistory('reviewed', [0, 1, 11]);

		const alone = masteryForChar('猫', [reviewed], history, NOW);

		expect(masteryForChar('猫', [reviewed, unreviewed], history, NOW)).toEqual(alone);
	});

	it('ignores malformed review events', () => {
		const clean = masteryForChar('猫', [card('c1', '猫')], [], NOW);

		expect(
			masteryForChar(
				'猫',
				[card('c1', '猫')],
				[
					malformedReview('c1', 9, new Date(BASE).toISOString()),
					malformedReview('c1', 3, 'not-a-timestamp'),
					malformedReview('', 3, new Date(BASE).toISOString())
				],
				NOW
			)
		).toEqual(clean);

		const valid = goodHistory('c1', [0, 1, 11]);
		expect(
			masteryForChar(
				'猫',
				[card('c1', '猫')],
				[
					...valid,
					malformedReview('c1', 9, new Date(BASE + 2 * DAY).toISOString()),
					malformedReview('c1', 3, 'not-a-timestamp')
				],
				NOW
			)
		).toEqual(masteryForChar('猫', [card('c1', '猫')], valid, NOW));
	});

	it('ignores legacy cards without a written snapshot', () => {
		const legacy = card('legacy');
		const history = goodHistory('legacy', [0, 1, 11, 41]);

		expect(masteryForChar('猫', [legacy], history, NOW)).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
	});

	it('only matches characters present in the written snapshot', () => {
		const cards = [card('c1', '猫咪')];
		const history = goodHistory('c1', [0, 1, 11]);

		expect(masteryForChar('猫', cards, history, NOW).reviewedCards).toBe(1);
		expect(masteryForChar('狗', cards, history, NOW).reviewedCards).toBe(0);
	});
});

describe('masterySummary', () => {
	const cards = [card('learned', '猫'), card('mature', '鸟')];
	const reviews = [
		...goodHistory('learned', [0, 1, 11, 41]),
		...goodHistory('mature', [0, 1, 11])
	];

	it('counts characters at or above the threshold', () => {
		expect(masterySummary(['猫', '狗', '鸟'], cards, reviews, NOW)).toEqual({
			mastered: 1,
			total: 3
		});
		expect(masterySummary(['猫', '狗', '鸟'], cards, reviews, NOW, 60)).toEqual({
			mastered: 2,
			total: 3
		});
		expect(masterySummary(['狗'], cards, reviews, NOW)).toEqual({ mastered: 0, total: 1 });
	});

	it('reports an empty summary for no characters', () => {
		expect(masterySummary([], cards, reviews, NOW)).toEqual({ mastered: 0, total: 0 });
	});
});
