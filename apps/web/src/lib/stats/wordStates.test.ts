import { IDENTITY_CLOCK } from '$lib/study/studyClock';
import { describe, expect, it } from 'vitest';

import { DEFAULT_W } from '$lib/study/fsrs/params';
import type { Schedule } from '$lib/study/scheduler';
import type { Deck, ReviewEvent, ReviewGrade, StudyCard, StudyCardKind } from '$lib/study/types';
import {
	MATURE_STABILITY_DAYS,
	classifySchedule,
	emptyCounts,
	wordStateCounts,
	wordStateShares,
	wordStateSummary
} from './wordStates';

const NOW = new Date('2026-11-14T12:00:00.000Z');

let seq = 0;
function review(cardId: string, grade: ReviewGrade, ts: string): ReviewEvent {
	seq += 1;
	return {
		id: `01JTEST${String(seq).padStart(19, '0')}`,
		workspaceId: 7,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	};
}

function card(id: string, deckIds: string[] = ['general'], kind: StudyCardKind = 'vocab'): StudyCard {
	return { id, kind, entryId: 1, deckIds, createdAt: '2026-01-01T00:00:00.000Z' };
}

function deck(id: string, name: string): Deck {
	return { id, name, createdAt: '2026-01-01T00:00:00.000Z' };
}

function schedule(state: number, stability: number): Schedule {
	return { due: NOW.toISOString(), stability, difficulty: 5, state };
}

describe('classifySchedule', () => {
	it('is new without a schedule (never reviewed)', () => {
		expect(classifySchedule(null)).toBe('new');
	});

	it('counts the learning and relearning states as learning', () => {
		expect(classifySchedule(schedule(1, 0.5))).toBe('learning');
		// Relearning keeps a large stability; it is still learning.
		expect(classifySchedule(schedule(3, 40))).toBe('learning');
	});

	it('splits review cards at 21 days of stability', () => {
		expect(MATURE_STABILITY_DAYS).toBe(21);
		expect(classifySchedule(schedule(2, 0))).toBe('young');
		expect(classifySchedule(schedule(2, 20.9))).toBe('young');
		expect(classifySchedule(schedule(2, 20.99))).toBe('young');
		expect(classifySchedule(schedule(2, 21))).toBe('mature');
		expect(classifySchedule(schedule(2, 400))).toBe('mature');
	});

	it('treats a review card with a broken stability as young', () => {
		expect(classifySchedule(schedule(2, Number.NaN))).toBe('young');
	});

	it('treats a schedule still in the new state as new', () => {
		expect(classifySchedule(schedule(0, 0))).toBe('new');
	});
});

describe('wordStateCounts', () => {
	it('is all zero for no cards', () => {
		const result = wordStateCounts([], [], [], NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.overall).toEqual(emptyCounts());
		expect(result.decks).toEqual([]);
	});

	it('counts never-reviewed cards as new', () => {
		const result = wordStateCounts([card('a'), card('b')], [], [], NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.overall).toEqual({ new: 2, learning: 0, young: 0, mature: 0, total: 2 });
	});

	it('derives the state from the real FSRS replay', () => {
		const cards = [card('fresh'), card('again'), card('good')];
		const reviews = [
			review('again', 1, '2026-11-14T10:00:00.000Z'),
			review('good', 4, '2026-11-01T10:00:00.000Z')
		];
		const result = wordStateCounts(cards, reviews, [], NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.overall.new).toBe(1);
		expect(result.overall.learning).toBe(1);
		// One Easy review moves a card straight into review with a few days of stability.
		expect(result.overall.young).toBe(1);
		expect(result.overall.total).toBe(3);
	});

	it('uses the injected schedule for the 21-day boundary', () => {
		const stabilities: Record<string, number> = { a: 20.99, b: 21 };
		const result = wordStateCounts([card('a'), card('b')], [], [], NOW, DEFAULT_W, IDENTITY_CLOCK, (id) =>
			schedule(2, stabilities[id])
		);
		expect(result.overall).toEqual({ new: 0, learning: 0, young: 1, mature: 1, total: 2 });
	});

	it('counts vocab cards only', () => {
		const cards = [card('v'), card('s', ['general'], 'sentence'), card('w', ['general'], 'writing'), card('t', ['general'], 'tone')];
		expect(wordStateCounts(cards, [], [], NOW, DEFAULT_W, IDENTITY_CLOCK).overall.total).toBe(1);
	});

	it('counts a card in several decks once overall and in each deck row', () => {
		const decks = [deck('d1', 'HSK 1'), deck('d2', 'Travel')];
		const cards = [card('a', ['d1', 'd2']), card('b', ['general'])];
		const result = wordStateCounts(cards, [], decks, NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.overall.total).toBe(2);
		expect(result.decks.map((row) => [row.id, row.name, row.counts.total])).toEqual([
			['general', 'General', 1],
			['d1', 'HSK 1', 1],
			['d2', 'Travel', 1]
		]);
	});

	it('ignores deleted deck ids, and cards left in no known deck', () => {
		const decks = [deck('d1', 'HSK 1')];
		const cards = [card('a', ['d1', 'gone']), card('orphan', ['gone'])];
		const result = wordStateCounts(cards, [], decks, NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.overall.total).toBe(1);
		expect(result.decks.map((row) => row.id)).toEqual(['d1']);
	});

	it('lists user decks even when empty but General only with cards', () => {
		const result = wordStateCounts([], [], [deck('d1', 'Empty')], NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.decks).toEqual([{ id: 'd1', name: 'Empty', counts: emptyCounts() }]);
	});

	it('ignores reviews of cards that no longer exist', () => {
		const result = wordStateCounts([card('a')], [review('gone', 3, '2026-11-10T00:00:00.000Z')], [], NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.overall).toEqual({ new: 1, learning: 0, young: 0, mature: 0, total: 1 });
	});
});

describe('wordStateShares', () => {
	it('lists the non-empty states in percent, none for zero words', () => {
		expect(wordStateShares(emptyCounts())).toEqual([]);
		expect(wordStateShares({ new: 1, learning: 0, young: 1, mature: 2, total: 4 })).toEqual([
			{ state: 'new', share: 25 },
			{ state: 'young', share: 25 },
			{ state: 'mature', share: 50 }
		]);
	});
});

describe('wordStateSummary', () => {
	it('describes the counts in words for the bar', () => {
		expect(wordStateSummary({ new: 3, learning: 1, young: 0, mature: 12, total: 16 })).toBe(
			'16 words: 3 new, 1 learning, 0 young, 12 mature'
		);
		expect(wordStateSummary({ new: 1, learning: 0, young: 0, mature: 0, total: 1 })).toBe(
			'1 word: 1 new, 0 learning, 0 young, 0 mature'
		);
	});
});
