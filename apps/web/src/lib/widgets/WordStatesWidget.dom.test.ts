import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	loadStudyHistory: vi.fn()
}));

import { loadStudyHistory } from '$lib/study/data';
import { workspaces } from '$lib/workspaces';
import WordStatesWidget from './WordStatesWidget.svelte';

beforeEach(() => {
	workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
	vi.mocked(loadStudyHistory).mockResolvedValue({
		decks: [{ id: 'd1', name: 'Verbs', createdAt: '2026-01-01T00:00:00.000Z' }],
		cards: [
			{ id: 'c-vocab-1', kind: 'vocab', entryId: 1, deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' },
			{ id: 'c-vocab-2', kind: 'vocab', entryId: 2, deckIds: ['d1'], createdAt: '2026-01-01T00:00:00.000Z' }
		],
		reviews: [],
		merged: 0
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('WordStatesWidget', () => {
	it('links each deck of the table to its view in the decks page', async () => {
		render(WordStatesWidget);
		const general = await screen.findByRole('link', { name: 'General' });
		expect(general.getAttribute('href')).toBe('/flashcards/deck/general');
		expect(screen.getByRole('link', { name: 'Verbs' }).getAttribute('href')).toBe('/flashcards/deck/d1');
	});
});
