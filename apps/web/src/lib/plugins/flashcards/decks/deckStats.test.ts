import { describe, expect, it } from 'vitest';

import fixture from '../../../../../../../docs/contracts/decks/deck-stats.json';
import { DEFAULT_W } from '$lib/study/fsrs/params';
import type { DeckSettings } from '$lib/study/deckSettings';
import { scheduleFor, type Schedule } from '$lib/study/scheduler';
import type { Deck, OptInKind, ReviewEvent, StudyCard, StudyCardKind } from '$lib/study/types';
import { wordStateCounts } from '$lib/stats/wordStates';
import { addDays } from '$lib/time/studyDay';
import { dueCounts } from '$lib/study/dueCounts';
import {
	RETENTION_MIN_REVIEWS,
	deckNumbers,
	progressShares,
	progressSummary,
	scheduleIndex,
	type DeckNumbers,
	type ScheduleIndex
} from './deckStats';

interface FixtureCard {
	id: string;
	kind: StudyCardKind;
	entryId: number;
	deckIds: string[];
	schedule: Schedule | null;
}
interface FixtureCase {
	name: string;
	now: string;
	today: string;
	decks: { id: string; name: string }[];
	deckSettings: Record<string, string[]>;
	cards: FixtureCard[];
	reviews: { cardId: string; ts: string; day: string; grade: number }[];
	expected: { deckId: string | null; kinds: StudyCardKind[]; numbers: DeckNumbers }[];
}

function toCards(list: FixtureCard[]): StudyCard[] {
	return list.map(({ id, kind, entryId, deckIds }) => ({
		id,
		kind,
		entryId,
		deckIds,
		createdAt: '2026-01-01T00:00:00.000Z'
	}));
}

function toReviews(list: FixtureCase['reviews']): ReviewEvent[] {
	return list.map((r, i) => ({
		id: `r${String(i).padStart(3, '0')}`,
		workspaceId: 1,
		device: 'd',
		ts: r.ts,
		type: 'review' as const,
		payload: { cardId: r.cardId, mode: 'vocab' as const, grade: r.grade as 1 | 2 | 3 | 4 }
	}));
}

function toSettings(raw: Record<string, string[]>): Record<string, DeckSettings> {
	return Object.fromEntries(
		Object.entries(raw).map(([deckId, cardTypes]) => [
			deckId,
			{ deckId, cardTypes: cardTypes as OptInKind[], extra: {} }
		])
	);
}

describe('deck numbers contract', () => {
	for (const c of fixture.cases as unknown as FixtureCase[]) {
		for (const expected of c.expected) {
			it(`${c.name}: ${expected.deckId ?? 'overall'}`, () => {
				const now = new Date(c.now);
				const dayByMs = new Map(c.reviews.map((r) => [Date.parse(r.ts), r.day]));
				const day = {
					dayOf: (ms: number) => (ms === now.getTime() ? c.today : (dayByMs.get(ms) as string)),
					today: () => c.today
				};
				const index: ScheduleIndex = new Map(
					c.cards.filter((card) => card.schedule !== null).map((card) => [card.id, card.schedule])
				);
				const got = deckNumbers({
					deckId: expected.deckId,
					cards: toCards(c.cards),
					decks: c.decks.map((d) => ({ ...d, createdAt: '2026-01-01T00:00:00.000Z' })),
					reviews: toReviews(c.reviews),
					index,
					kinds: expected.kinds,
					deckSettings: toSettings(c.deckSettings),
					now,
					w: DEFAULT_W,
					day,
					addDays
				});
				const want = expected.numbers;
				expect({ ...got, retention: got.retention === null ? null : Math.round(got.retention * 1e4) / 1e4 }).toEqual(want);
			});
		}
	}
});

// ---- helpers for the behavioural tests ------------------------------------------------------

function card(id: string, kind: StudyCardKind, entryId: number, deckIds: string[]): StudyCard {
	return { id, kind, entryId, deckIds, createdAt: '2026-01-01T00:00:00.000Z' };
}
function review(cardId: string, ts: string, grade: 1 | 2 | 3 | 4, n = 0): ReviewEvent {
	return {
		id: `${ts}-${cardId}-${n}`,
		workspaceId: 1,
		device: 'd',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	};
}
const NOW = new Date('2026-03-10T12:00:00.000Z');
const utcDay = { dayOf: (ms: number) => new Date(ms).toISOString().slice(0, 10), today: () => '2026-03-10' };
const deck = (id: string): Deck => ({ id, name: id, createdAt: '2026-01-01T00:00:00.000Z' });

function numbers(
	deckId: string | null,
	cards: StudyCard[],
	reviews: ReviewEvent[],
	decks: Deck[] = [deck('d1'), deck('d2')]
): DeckNumbers {
	return deckNumbers({
		deckId,
		cards,
		decks,
		reviews,
		index: scheduleIndex(cards, reviews, DEFAULT_W),
		kinds: ['vocab'],
		now: NOW,
		w: DEFAULT_W,
		day: utcDay,
		addDays
	});
}

function longHistory(cardId: string, kind: StudyCardKind = 'vocab'): ReviewEvent[] {
	const out: ReviewEvent[] = [];
	let ts = Date.parse('2025-01-01T00:00:00.000Z');
	for (let i = 0; i < 8; i++) {
		const iso = new Date(ts).toISOString();
		out.push({ ...review(cardId, iso, 4, i), payload: { cardId, mode: kind, grade: 4 } });
		const s = scheduleFor(cardId, out, NOW, DEFAULT_W);
		ts = Date.parse(s?.due ?? iso);
	}
	return out;
}

describe('deckNumbers', () => {
	it('states equal wordStateCounts for the deck', () => {
		const cards = [
			card('c-vocab-1', 'vocab', 1, ['d1']),
			card('c-vocab-2', 'vocab', 2, ['d1', 'd2']),
			card('c-vocab-3', 'vocab', 3, ['d1']),
			card('c-writing-1', 'writing', 1, ['d1'])
		];
		const reviews = [
			...longHistory('c-vocab-1'),
			review('c-vocab-2', '2026-03-10T09:00:00.000Z', 1)
		];
		const decks = [deck('d1'), deck('d2')];
		const got = numbers('d1', cards, reviews, decks);
		const want = wordStateCounts(cards, reviews, decks, NOW, DEFAULT_W).decks.find((d) => d.id === 'd1')!;
		expect(got.states).toEqual(want.counts);
		expect(got.words).toBe(3);
		expect(got.cards).toBe(4);
		expect(got.studied).toBe(got.states.total - got.states.new);
	});

	it('counts a card in two decks once overall', () => {
		const cards = [card('c-vocab-1', 'vocab', 1, ['d1', 'd2']), card('c-vocab-2', 'vocab', 2, ['gone'])];
		const got = numbers(null, cards, []);
		expect(got.words).toBe(1);
		expect(got.cards).toBe(1);
	});

	it('a reverse card with a long Easy history changes neither studied nor mastered', () => {
		const cards = [card('c-vocab-1', 'vocab', 1, ['d1']), card('c-reverse-1', 'reverse', 1, ['d1'])];
		const got = numbers('d1', cards, longHistory('c-reverse-1', 'reverse'));
		expect(got.studied).toBe(0);
		expect(got.mastered).toBe(0);
		expect(got.states.new).toBe(1);
		expect(got.cards).toBe(2);
	});

	it('mastered is cardScore >= 80 of the vocab card', () => {
		const cards = [card('c-vocab-1', 'vocab', 1, ['d1']), card('c-vocab-2', 'vocab', 2, ['d1'])];
		const reviews = [...longHistory('c-vocab-1'), review('c-vocab-2', '2026-03-10T09:00:00.000Z', 3)];
		const got = numbers('d1', cards, reviews);
		expect(got.mastered).toBe(1);
		expect(got.studied).toBe(2);
	});

	it('due and new equal the home widget counts for the same deck', () => {
		const cards = [card('c-vocab-1', 'vocab', 1, ['d1']), card('c-vocab-2', 'vocab', 2, ['d1']), card('c-vocab-3', 'vocab', 3, ['d2'])];
		const reviews = [review('c-vocab-1', '2026-03-01T09:00:00.000Z', 3)];
		const got = numbers('d1', cards, reviews);
		const widget = dueCounts({ cards, reviews, deckIds: ['d1'], kinds: ['vocab'], now: NOW, w: DEFAULT_W });
		expect({ due: got.due, fresh: got.fresh }).toEqual(widget);
	});

	it('excludes first reviews from retention and shows null under the floor', () => {
		const reviews: ReviewEvent[] = [review('c-vocab-1', '2026-03-01T09:00:00.000Z', 1)];
		for (let i = 0; i < RETENTION_MIN_REVIEWS - 1; i++) {
			reviews.push(review('c-vocab-1', `2026-03-0${2 + (i % 8)}T1${i % 9}:00:00.000Z`, 3, i));
		}
		const cards = [card('c-vocab-1', 'vocab', 1, ['d1'])];
		expect(RETENTION_MIN_REVIEWS).toBe(10);
		const nine = numbers('d1', cards, reviews);
		expect(nine.retentionBase).toBe(9);
		expect(nine.retention).toBeNull();
		reviews.push(review('c-vocab-1', '2026-03-09T20:00:00.000Z', 1, 99));
		const ten = numbers('d1', cards, reviews);
		expect(ten.retentionBase).toBe(10);
		expect(ten.retention).toBeCloseTo(0.9);
	});

	it('only reviews inside the 30 learner days count', () => {
		const cards = [card('c-vocab-1', 'vocab', 1, ['d1'])];
		const reviews = [
			review('c-vocab-1', '2026-02-08T23:00:00.000Z', 3), // day 31 back
			review('c-vocab-1', '2026-02-09T00:00:00.000Z', 3), // day 30 back: in
			review('c-vocab-1', '2026-03-10T11:00:00.000Z', 3)
		];
		expect(numbers('d1', cards, reviews).reviews30).toBe(2);
	});
});

describe('scheduleIndex', () => {
	it('replays each reviewed card once: 5,000 cards, 50,000 reviews, 20 decks', () => {
		const cards: StudyCard[] = [];
		const reviews: ReviewEvent[] = [];
		for (let i = 0; i < 5000; i++) {
			cards.push(card(`c-vocab-${i}`, 'vocab', i, [`d${i % 20}`]));
		}
		for (let i = 0; i < 50000; i++) {
			const c = i % 5000;
			if (c % 2 === 1) continue; // half the cards are never reviewed
			reviews.push(review(`c-vocab-${c}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i % 3600)).toISOString(), 3, i));
		}
		const calls: string[] = [];
		const index = scheduleIndex(cards, reviews, DEFAULT_W, (id, history, now, w) => {
			calls.push(id);
			return scheduleFor(id, history, now, w);
		});
		expect(calls.length).toBe(2500);
		expect(new Set(calls).size).toBe(2500);
		expect(index.size).toBe(2500);

		const decks = Array.from({ length: 20 }, (_, i) => deck(`d${i}`));
		const before = calls.length;
		const sample = reviews.slice(0, 2000);
		for (const d of decks) {
			deckNumbers({ deckId: d.id, cards, decks, reviews: sample, index, kinds: ['vocab'], now: NOW, w: DEFAULT_W, day: utcDay, addDays });
		}
		expect(calls.length).toBe(before);
	});

	it('numbers follow the index, not a replay', () => {
		const cards = [card('c-vocab-1', 'vocab', 1, ['d1'])];
		const reviews = [review('c-vocab-1', '2026-03-01T09:00:00.000Z', 3)];
		const index: ScheduleIndex = new Map([
			['c-vocab-1', { state: 2, stability: 500, difficulty: 3, due: '2026-03-09T00:00:00.000Z' }]
		]);
		const got = deckNumbers({ deckId: 'd1', cards, decks: [deck('d1')], reviews, index, kinds: ['vocab'], now: NOW, w: DEFAULT_W, day: utcDay, addDays });
		expect(got.states.mature).toBe(1);
		expect(got.mastered).toBe(1);
		expect(got.due).toBe(1);
	});
});

describe('progress', () => {
	const n = { words: 40, studied: 18, mastered: 12 } as DeckNumbers;
	it('summarises with text', () => {
		expect(progressSummary(n)).toBe('40 words: 12 mastered, 18 studied');
		expect(progressSummary({ ...n, words: 1, studied: 1, mastered: 0 })).toBe('1 word: 0 mastered, 1 studied');
	});
	it('shares add to 100 and split mastered, studied-not-mastered, rest', () => {
		const s = progressShares(n);
		expect(s.mastered).toBeCloseTo(30);
		expect(s.studied).toBeCloseTo(15);
		expect(s.rest).toBeCloseTo(55);
		expect(progressShares({ ...n, words: 0 } as DeckNumbers)).toEqual({ mastered: 0, studied: 0, rest: 0 });
	});
});
