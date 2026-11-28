import { describe, expect, it } from 'vitest';

import { validateConfig } from '$lib/features/flashcards/session/session';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { UTC_CONTEXT } from '$lib/studycore/studyContext';
import type { ReviewEvent } from '$lib/studycore/types';
import { cardSessionConfig, dueCardIds } from './practise';

function review(n: number, cardId: string, ts: string, grade: 1 | 3): ReviewEvent {
	return { id: `01JREVIEW${String(n).padStart(17, '0')}`, workspaceId: 1, device: 'web', ts, type: 'review', payload: { cardId, mode: 'vocab', grade } };
}

const NOW = new Date('2026-06-01T12:00:00Z');

describe("practising the notebook's cards", () => {
	it('picks the cards that are due now, never one answered a moment ago or one without a review', () => {
		const reviews = [review(1, 'a', '2026-01-02T00:00:00Z', 1), review(2, 'b', '2026-06-01T11:59:30Z', 1), review(3, 'x', '2026-01-02T00:00:00Z', 1)];
		expect(dueCardIds(['a', 'b', 'c'], reviews, NOW, DEFAULT_W, UTC_CONTEXT)).toEqual(['a']);
	});

	it('none on a vacation day', () => {
		const reviews = [review(1, 'a', '2026-01-02T00:00:00Z', 1)];
		expect(dueCardIds(['a'], reviews, NOW, DEFAULT_W, { ...UTC_CONTEXT, vacationToday: true })).toEqual([]);
	});

	it('the session is a valid deck session limited to the cards, over their decks, without daily limits', () => {
		const config = cardSessionConfig(['general', 'd1'], ['a'], '/notebook', 7);
		expect(config).toMatchObject({ mode: 'decks', deckIds: ['general', 'd1'], cardIds: ['a'], studyAll: true, seed: 7, from: '/notebook' });
		expect(config.cardTypes).toEqual(['vocab', 'sentence', 'writing', 'tone', 'reverse', 'cloze']);
		expect(validateConfig(config)).toEqual([]);
	});
});
