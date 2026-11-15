import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/study/history', () => ({
	loadStudyHistory: vi.fn(),
	invalidateStudyHistory: vi.fn()
}));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	createDeck: vi.fn()
}));

import { loadStudyHistory } from '$lib/study/history';
import { createDeck } from '$lib/study/store';
import { SESSION_CONFIG_KEY } from '$lib/study/session';
import type { Deck, ReviewEvent, StudyCard, StudyHistory } from '$lib/study/types';
import { workspaces } from '$lib/workspaces';
import DeckList from './DeckList.svelte';

const verbs: Deck = { id: 'd1', name: 'Verbs', createdAt: '2026-01-01T00:00:00.000Z' };

function card(n: number, deckIds: string[]): StudyCard {
	return { id: `c-vocab-${n}`, kind: 'vocab', entryId: n, written: `w${n}`, deckIds, createdAt: `2026-01-0${n}T00:00:00.000Z` };
}
function review(cardId: string): ReviewEvent {
	return {
		id: `r-${cardId}`,
		workspaceId: 1,
		device: 'd',
		ts: '2026-01-01T09:00:00.000Z',
		type: 'review',
		payload: { cardId, mode: 'vocab', grade: 3 }
	};
}
function history(over: Partial<StudyHistory> = {}): StudyHistory {
	return {
		decks: [verbs],
		cards: [card(1, ['general']), card(2, ['d1']), card(3, ['d1'])],
		reviews: [review('c-vocab-1')],
		merged: 0,
		...over
	};
}

beforeEach(() => {
	workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
	vi.mocked(loadStudyHistory).mockResolvedValue(history());
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('DeckList', () => {
	it('shows loading, then the overall numbers and one row per deck', async () => {
		render(DeckList);
		expect(screen.getByRole('status').textContent).toContain('Loading');
		await screen.findByRole('link', { name: 'Verbs' });
		const general = screen.getByRole('link', { name: 'General' });
		expect(general.getAttribute('href')).toBe('/p/flashcards/deck/general');
		expect(screen.getByRole('link', { name: 'Verbs' }).getAttribute('href')).toBe('/p/flashcards/deck/d1');
		const row = screen.getByRole('link', { name: 'Verbs' }).closest('li') as HTMLElement;
		expect(row.textContent).toContain('2 words · 2 cards');
		expect(within(row).getByText('0 due')).toBeTruthy();
		expect(within(row).getByText('2 new')).toBeTruthy();
		const panel = screen.getByRole('region', { name: 'Overall' });
		expect(panel.textContent).toContain('3');
	});

	it('gives each bar a text alternative', async () => {
		render(DeckList);
		await screen.findByRole('link', { name: 'Verbs' });
		const verbsRow = screen.getByRole('link', { name: 'Verbs' }).closest('li') as HTMLElement;
		expect(within(verbsRow).getByRole('img').getAttribute('aria-label')).toBe('2 words: 0 mastered, 0 studied');
		const generalRow = screen.getByRole('link', { name: 'General' }).closest('li') as HTMLElement;
		expect(within(generalRow).getByRole('img').getAttribute('aria-label')).toBe('1 word: 0 mastered, 1 studied');
	});

	it('lists General only when it holds cards', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ cards: [card(2, ['d1'])] }));
		render(DeckList);
		await screen.findByRole('link', { name: 'Verbs' });
		expect(screen.queryByRole('link', { name: 'General' })).toBeNull();
	});

	it('Study writes a session over this deck only and goes to the session', async () => {
		render(DeckList);
		const study = await screen.findByRole('button', { name: 'Study Verbs' });
		await fireEvent.click(study);
		const saved = JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY) as string);
		expect(saved).toMatchObject({ mode: 'decks', deckIds: ['d1'], cardTypes: ['vocab'] });
		expect(goto).toHaveBeenCalledWith('/study/session');
	});

	it('includes the opt-in kinds a deck enables and says more cards appear while studying', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ deckSettings: { d1: { deckId: 'd1', cardTypes: ['reverse'], extra: {} } } })
		);
		render(DeckList);
		const row = (await screen.findByRole('link', { name: 'Verbs' })).closest('li') as HTMLElement;
		expect(row.textContent).toContain('+ reverse/cloze cards as you study');
		await fireEvent.click(within(row).getByRole('button', { name: 'Study Verbs' }));
		expect(JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY) as string).cardTypes).toEqual(['vocab', 'reverse']);
	});

	it('links Settings per deck', async () => {
		render(DeckList);
		const row = (await screen.findByRole('link', { name: 'Verbs' })).closest('li') as HTMLElement;
		expect(within(row).getByRole('link', { name: 'Settings for Verbs' }).getAttribute('href')).toBe(
			'/p/flashcards/deck/d1/settings'
		);
	});

	it('New deck creates and lists it', async () => {
		vi.mocked(createDeck).mockResolvedValue({ id: 'd2', name: 'Nouns', createdAt: '2026-02-01T00:00:00.000Z' });
		render(DeckList);
		await screen.findByRole('link', { name: 'Verbs' });
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ decks: [verbs, { id: 'd2', name: 'Nouns', createdAt: '2026-02-01T00:00:00.000Z' }] })
		);
		await fireEvent.input(screen.getByLabelText('New deck name'), { target: { value: 'Nouns' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
		expect(createDeck).toHaveBeenCalledWith('Nouns');
		await screen.findByRole('link', { name: 'Nouns' });
	});

	it('refuses an empty deck name', async () => {
		render(DeckList);
		await screen.findByRole('link', { name: 'Verbs' });
		await fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
		expect(createDeck).not.toHaveBeenCalled();
		expect((await screen.findByRole('alert')).textContent).toContain('name');
	});

	it('shows a load error with Try again', async () => {
		vi.mocked(loadStudyHistory).mockRejectedValueOnce(new Error('offline'));
		render(DeckList);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('offline');
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await screen.findByRole('link', { name: 'Verbs' });
	});

	it('asks for a workspace when none is selected', async () => {
		workspaces.set({ list: [], current: null });
		render(DeckList);
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('workspace'));
	});
});
