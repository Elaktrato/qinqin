import { describe, expect, it } from 'vitest';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { UTC_CONTEXT, type StudyContext } from '$lib/studycore/studyContext';
import type { ReviewEvent, StudyCard } from '$lib/studycore/types';
import { deckLeftToday, type LeftInput } from './deckLimits';
import * as build from '$lib/testing/study';

const NOW = new Date('2026-03-10T12:00:00Z');
const card = (id: string, deckIds: string[], n: number): StudyCard =>
	build.card({ id, entryId: n, deckIds, createdAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00Z` });
const cards = [1, 2, 3, 4, 5].map((n) => card(`c${n}`, n <= 4 ? ['d1'] : ['d2'], n));
const input = (ctx: StudyContext, reviews: ReviewEvent[] = []): LeftInput => ({
	cards, reviews, deckSettings: {}, now: NOW, weights: DEFAULT_W, ctx, index: new Map()
});
const rows = (workspace: object | null, decks: object = {}): StudyContext => ({
	...UTC_CONTEXT,
	limits: { workspace, decks, existingDecks: null } as never
});
const rev = (cardId: string, ts: string): ReviewEvent => ({
	id: `01JT${cardId}${ts}`.slice(0, 26).padEnd(26, '0'), workspaceId: 1, device: 'w', ts, type: 'review', payload: { cardId, mode: 'vocab', grade: 3 }
});

describe('deckLeftToday', () => {
	it('is the new cards a deck may still start today, min of what is there and the allowance', () => {
		expect(deckLeftToday(input(rows({ new: 3 })), 'd1', ['vocab'])).toEqual({ new: 3, reviews: 0 });
		expect(deckLeftToday(input(rows({ new: 10 })), 'd1', ['vocab'])).toEqual({ new: 4, reviews: 0 });
	});
	it('shows null for an unlimited field', () => {
		expect(deckLeftToday(input(rows({ new: null, reviews: null })), 'd1', ['vocab'])).toEqual({ new: null, reviews: null });
	});
	it('uses the deck row over the workspace row', () => {
		expect(deckLeftToday(input(rows({ new: 1 }, { d1: { new: 2 } })), 'd1', ['vocab']).new).toBe(2);
	});
	it('counts what was started today', () => {
		const reviews = [rev('c1', '2026-03-10T08:00:00Z')];
		expect(deckLeftToday(input(rows({ new: 3 }), reviews), 'd1', ['vocab']).new).toBe(2);
	});
	it('is zero on a vacation day', () => {
		expect(deckLeftToday(input({ ...rows({ new: 3 }), vacationToday: true }), 'd1', ['vocab'])).toEqual({ new: 0, reviews: 0 });
	});
});
