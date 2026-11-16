import { UTC_CONTEXT } from '$lib/study/studyContext';
import { IDENTITY_CLOCK } from '$lib/study/studyClock';
import { describe, expect, it } from 'vitest';

import { dueCounts, leftToday } from './dueCounts';
import type { DeckSettings } from './deckSettings';
import { DEFAULT_W } from './fsrs/params';
import { buildQueue, scheduleFor } from './scheduler';
import type { ReviewEvent, ReviewGrade, StudyCard, StudyCardKind } from './types';

const NOW = new Date('2026-03-01T12:00:00Z');

function card(id: string, kind: StudyCardKind, entryId: number, extra: Partial<StudyCard> = {}): StudyCard {
	return {
		id,
		kind,
		entryId,
		deckIds: ['general'],
		createdAt: `2026-01-0${entryId}T00:00:00.000Z`,
		...extra
	};
}

function review(cardId: string, ts: string, grade: ReviewGrade = 3): ReviewEvent {
	return {
		id: `${cardId}-${ts}`,
		workspaceId: 1,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	};
}

describe('dueCounts equals the old widget computation without deck settings', () => {
	const cards = [1, 2, 3, 4, 5].map((n) => card(`c-vocab-${n}`, 'vocab', n));
	const reviews = [
		review('c-vocab-1', '2026-01-05T00:00:00Z', 1),
		review('c-vocab-2', '2026-01-06T00:00:00Z', 1),
		review('c-vocab-3', '2026-02-28T00:00:00Z', 4)
	];
	const scenarios = [
		{ newLimit: 20, reviewLimit: 100 },
		{ newLimit: 1, reviewLimit: 1 },
		{ newLimit: 0, reviewLimit: 0 }
	];
	for (const limits of scenarios) {
		it(`limits ${JSON.stringify(limits)}`, () => {
			const base = { ctx: UTC_CONTEXT, cards, reviews, deckIds: ['general'], now: NOW, kinds: ['vocab'] as StudyCardKind[], w: DEFAULT_W };
			const old = {
				due: buildQueue({ ...base, newLimit: 0, reviewLimit: limits.reviewLimit }).length,
				fresh: buildQueue({ ...base, newLimit: limits.newLimit, reviewLimit: 0 }).length
			};
			expect(dueCounts({ ...base, ...limits })).toEqual(old);
		});
	}

	it('is unlimited by default', () => {
		const out = dueCounts({ ctx: UTC_CONTEXT, cards, reviews, deckIds: ['general'], now: NOW, kinds: ['vocab'], w: DEFAULT_W });
		expect(out).toEqual({ due: 2, fresh: 2 });
	});
});

describe('dueCounts with reverse and cloze', () => {
	const settings: Record<string, DeckSettings> = {
		general: { deckId: 'general', cardTypes: ['reverse'], extra: {} }
	};
	const cards = [
		card('c-vocab-1', 'vocab', 1),
		card('c-reverse-1', 'reverse', 1),
		card('c-vocab-2', 'vocab', 2),
		card('c-reverse-2', 'reverse', 2)
	];
	const base = { ctx: UTC_CONTEXT, cards, reviews: [] as ReviewEvent[], deckIds: ['general'], now: NOW, kinds: ['vocab', 'reverse'] as StudyCardKind[], w: DEFAULT_W };

	it('counts a real reverse card only where its deck enables it', () => {
		expect(dueCounts({ ...base, deckSettings: settings }).fresh).toBe(4);
		expect(dueCounts({ ...base, deckSettings: {} }).fresh).toBe(2);
	});

	it('a buried reverse card is not due', () => {
		const reviews = [review('c-vocab-1', '2026-03-01T08:00:00Z', 3)];
		const out = dueCounts({ ...base, reviews, deckSettings: settings });
		// vocab 1 is answered and its first learning step is already due again;
		// its reverse card is buried (not counted as new); vocab 2 and reverse 2 are new.
		expect(out).toEqual({ due: 1, fresh: 2 });
	});

	it('passes a schedule lookup through', () => {
		const reviews = [review('c-vocab-1', '2026-01-05T00:00:00Z', 1)];
		const withLookup = dueCounts({
			...base,
			reviews,
			deckSettings: settings,
			scheduleOf: (id) => scheduleFor(id, reviews, NOW, DEFAULT_W, IDENTITY_CLOCK)
		});
		expect(withLookup).toEqual(dueCounts({ ...base, reviews, deckSettings: settings }));
	});
});

describe('daily limits in counts', () => {
	const cardsMany = Array.from({ length: 30 }, (_, i) => card(`m${i}`, 'vocab', i + 1));
	const input = {
		ctx: UTC_CONTEXT,
		cards: cardsMany,
		reviews: [] as ReviewEvent[],
		deckIds: ['general'],
		now: NOW,
		kinds: ['vocab'] as StudyCardKind[],
		w: DEFAULT_W
	};

	it('does not apply the daily limits unless asked (the decks view shows raw numbers)', () => {
		expect(dueCounts(input)).toEqual({ due: 0, fresh: 30 });
		expect(dueCounts({ ...input, applyDailyLimits: true })).toEqual({ due: 0, fresh: 20 });
	});

	it('leftToday equals what admission admits with the session caps removed', () => {
		const left = leftToday(input);
		expect(left).toMatchObject({ reviews: 0, new: 20, unlimited: false, limitedOut: 10 });
	});

	it('leftToday is zero on a vacation day', () => {
		expect(leftToday({ ...input, ctx: { ...UTC_CONTEXT, vacationToday: true } })).toMatchObject({ reviews: 0, new: 0 });
	});
});
