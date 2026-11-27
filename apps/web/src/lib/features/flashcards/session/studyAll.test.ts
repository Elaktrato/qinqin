import { describe, expect, it } from 'vitest';

import { deckSessionItems, deckSessionPlan, sessionCounts } from './cardFlow';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { buildLevelPlan, levelPlanCounts, type LevelEntry } from './levelQueue';
import { contextFor, UTC_CONTEXT, type LimitRows, type StudyContext } from '$lib/studycore/studyContext';
import type { ReviewEvent, StudyCard } from '$lib/studycore/types';

// One Study all behaviour (#175): the same words give the same session in a
// deck session and in a word-level session, whatever the limit rows say, and
// the setup's Study all numbers are the session's.

const NOW = new Date('2026-06-01T12:00:00Z');
const WORDS = 30;
const DUE = 5;

const cards: StudyCard[] = Array.from({ length: WORDS }, (_, i) => ({
	id: `c-vocab-${i + 1}`,
	kind: 'vocab',
	entryId: i + 1,
	written: '学习',
	deckIds: ['general'],
	createdAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`
}));
// The first DUE words were learned long ago and are due; the rest are new.
const reviews: ReviewEvent[] = cards.slice(0, DUE).map((card, i) => ({
	id: `01JREVIEW${String(i).padStart(17, '0')}`,
	workspaceId: 1,
	device: 'web',
	ts: '2026-01-02T00:00:00Z',
	type: 'review',
	payload: { cardId: card.id, mode: 'vocab', grade: 3 }
}));
const entries: LevelEntry[] = cards.map((card) => ({ id: card.entryId, kind: 'word' }));

function withRows(rows: LimitRows): StudyContext {
	return contextFor(UTC_CONTEXT.day, [], NOW.getTime(), [], rows);
}

const ROWS: Record<string, StudyContext> = {
	'no limit rows (the defaults)': UTC_CONTEXT,
	'limits of zero': withRows({
		workspace: { new: 0, reviews: 0 },
		decks: { general: { new: 0, reviews: 0 } },
		existingDecks: null
	}),
	'small limits': withRows({ workspace: { new: 3, reviews: 2 }, decks: {}, existingDecks: null })
};

const common = { cards, reviews, now: NOW, w: DEFAULT_W, newLimit: 1, reviewLimit: 1 };

function deckPlan(ctx: StudyContext, studyAll: boolean) {
	return deckSessionPlan({ ...common, ctx, deckIds: ['general'], kinds: ['vocab'], language: 'zh', studyAll });
}

function levelPlan(ctx: StudyContext, studyAll: boolean) {
	return buildLevelPlan({ ...common, ctx, entries, studyAll });
}

describe('Study all is one behaviour in deck and level sessions', () => {
	it.each(Object.entries(ROWS))('%s: both modes hold every due and new word', (_name, ctx) => {
		const deck = deckPlan(ctx, true);
		const level = levelPlan(ctx, true);
		expect(deck.queue.map((item) => item.cardId)).toHaveLength(WORDS);
		expect(level.queue.map((item) => item.cardId).sort()).toEqual(deck.queue.map((item) => item.cardId).sort());
		expect(sessionCounts(deck.queue, reviews)).toMatchObject({ due: DUE, fresh: WORDS - DUE });
		expect(deck.backfillLeft).toBe(level.backfillLeft);
	});

	it.each(Object.entries(ROWS))('%s: without Study all both modes admit the same', (_name, ctx) => {
		const deck = deckPlan(ctx, false).queue.map((item) => item.cardId);
		const level = levelPlan(ctx, false).queue.map((item) => item.cardId);
		expect(level.sort()).toEqual(deck.sort());
		expect(deck.length).toBeLessThanOrEqual(2);
	});

	it.each(Object.entries(ROWS))("%s: the setup's Study all numbers are the session's", (_name, ctx) => {
		const deckSetup = sessionCounts(
			deckSessionItems({ ...common, ctx, deckIds: ['general'], kinds: ['vocab'], language: 'zh', studyAll: true }),
			reviews
		);
		expect(deckSetup).toEqual(sessionCounts(deckPlan(ctx, true).queue, reviews));
		const levelSetup = levelPlanCounts({ cards, reviews, now: NOW, w: DEFAULT_W, ctx, entries, studyAll: true });
		expect(levelSetup).toMatchObject({ due: deckSetup.due, fresh: deckSetup.fresh, items: WORDS });
	});
});
