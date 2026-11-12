import { describe, expect, it } from 'vitest';

import {
	masteryForChar,
	masteryForChars,
	masterySummary,
	stageOf,
	summarizeMastery
} from './mastery';
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

describe('masteryForChars', () => {
	it('matches masteryForChar across many characters and cards', () => {
		// 40 characters, two cards each, with a mix of short and long
		// histories plus a few unreviewed cards. Every card's written form
		// is a two-character word, so most characters share cards.
		const chars = Array.from({ length: 40 }, (_, index) =>
			String.fromCodePoint(0x4e00 + index)
		);
		const cards: StudyCard[] = [];
		const reviews: ReviewEvent[] = [];
		for (let index = 0; index < chars.length; index += 1) {
			const next = chars[(index + 1) % chars.length];
			const pair = card(`pair-${index}`, `${chars[index]}${next}`);
			const single = card(`single-${index}`, chars[index]);
			cards.push(pair, single);
			if (index % 7 !== 0) {
				const offsets = index % 3 === 0 ? [0] : [0, 1, 11, 41];
				reviews.push(
					...goodHistory(pair.id, offsets),
					...goodHistory(single.id, offsets)
				);
			}
		}
		// A character no card contains, and a legacy card with no snapshot.
		cards.push(card('legacy'));
		const requested = [...chars, '龍'];

		const map = masteryForChars(requested, cards, reviews, NOW);

		for (const char of requested) {
			expect(map.get(char), char).toEqual(masteryForChar(char, cards, reviews, NOW));
		}
	});

	it('reports unknown for the empty character', () => {
		const cards = [card('c1', '猫')];
		const history = goodHistory('c1', [0, 1, 11, 41]);

		expect(masteryForChars([''], cards, history, NOW).get('')).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
		expect(masteryForChar('', cards, history, NOW)).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
	});

	it('includes every requested character, even without a reviewed card', () => {
		const map = masteryForChars(['猫', '狗'], [card('c1', '猫')], goodHistory('c1', [0]), NOW);

		expect(map.size).toBe(2);
		expect(map.get('狗')).toEqual({ score: 0, stage: 'unknown', reviewedCards: 0 });
	});

	it('counts one card once per character even when the written form repeats it', () => {
		const history = goodHistory('c1', [0, 1, 11]);
		const once = masteryForChar('猫', [card('c1', '猫')], history, NOW);
		const repeated = masteryForChar('猫', [card('c1', '猫猫')], history, NOW);

		expect(repeated).toEqual(once);
		expect(repeated.reviewedCards).toBe(1);
	});

	it('returns an empty map for no characters', () => {
		expect(masteryForChars([], [card('c1', '猫')], goodHistory('c1', [0]), NOW).size).toBe(0);
	});
});

describe('summarizeMastery', () => {
	const cards = [card('learned', '猫'), card('mature', '鸟')];
	const reviews = [
		...goodHistory('learned', [0, 1, 11, 41]),
		...goodHistory('mature', [0, 1, 11])
	];

	it('counts from an already-computed mastery map', () => {
		const chars = ['猫', '狗', '鸟'];
		const shared = masteryForChars(chars, cards, reviews, NOW);

		expect(summarizeMastery(chars, shared)).toEqual({
			mastered: 1,
			total: 3
		});
		expect(summarizeMastery(chars, shared, 60)).toEqual({
			mastered: 2,
			total: 3
		});
	});

	it('agrees with masterySummary', () => {
		const chars = ['猫', '狗', '鸟'];

		expect(summarizeMastery(chars, masteryForChars(chars, cards, reviews, NOW))).toEqual(
			masterySummary(chars, cards, reviews, NOW)
		);
	});
});

describe('stageOf', () => {
	it('maps the exact band boundaries', () => {
		const cases: Array<[number, string]> = [
			[0, 'unknown'],
			[1, 'fresh'],
			[24, 'fresh'],
			[25, 'learning'],
			[49, 'learning'],
			[50, 'mature'],
			[79, 'mature'],
			[80, 'learned'],
			[100, 'learned']
		];

		for (const [score, stage] of cases) {
			expect(stageOf(score), String(score)).toBe(stage);
		}
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

	it('agrees with the per-character scores across many characters', () => {
		const chars = Array.from({ length: 25 }, (_, index) =>
			String.fromCodePoint(0x4e00 + index)
		);
		const manyCards: StudyCard[] = [];
		const manyReviews: ReviewEvent[] = [];
		for (let index = 0; index < chars.length; index += 1) {
			const item = card(`summary-${index}`, chars[index]);
			manyCards.push(item);
			if (index % 2 === 0) {
				manyReviews.push(...goodHistory(item.id, [0, 1, 11, 41]));
			} else if (index % 3 === 0) {
				manyReviews.push(...goodHistory(item.id, [0, 1, 11]));
			}
		}

		const expected = chars.filter(
			(char) => masteryForChar(char, manyCards, manyReviews, NOW).score >= 80
		).length;

		expect(masterySummary(chars, manyCards, manyReviews, NOW)).toEqual({
			mastered: expected,
			total: chars.length
		});
	});
});
