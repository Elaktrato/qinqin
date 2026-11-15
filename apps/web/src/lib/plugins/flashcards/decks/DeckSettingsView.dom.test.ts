import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn(), invalidateStudyHistory: vi.fn() }));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	renameDeck: vi.fn(),
	deleteDeck: vi.fn(),
	saveDeckCardTypes: vi.fn()
}));

import { loadStudyHistory } from '$lib/study/history';
import { deleteDeck, renameDeck, saveDeckCardTypes } from '$lib/study/store';
import type { Deck, StudyCard } from '$lib/study/types';
import { workspaces } from '$lib/workspaces';
import DeckSettingsView from './DeckSettingsView.svelte';
import LimitsStub from './testing/LimitsStub.svelte';

const greetings: Deck = { id: 'd1', name: 'Greetings', createdAt: '2026-01-01T00:00:00.000Z' };
const verbs: Deck = { id: 'd2', name: 'Verbs', createdAt: '2026-01-02T00:00:00.000Z' };
function card(n: number, deckIds: string[]): StudyCard {
	return { id: `c-vocab-${n}`, kind: 'vocab', entryId: n, deckIds, createdAt: '2026-01-01T00:00:00.000Z' };
}

beforeEach(() => {
	workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
	vi.mocked(loadStudyHistory).mockResolvedValue({
		decks: [greetings, verbs],
		cards: [card(1, ['d1']), card(2, ['d1', 'd2']), card(3, ['d1'])],
		reviews: [],
		merged: 0,
		deckSettings: { d1: { deckId: 'd1', cardTypes: ['cloze'], extra: {} } }
	});
	vi.mocked(renameDeck).mockResolvedValue({ ...greetings, name: 'Hello' });
	vi.mocked(deleteDeck).mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('DeckSettingsView', () => {
	it('renames a deck and refuses an empty name', async () => {
		render(DeckSettingsView, { deckId: 'd1' });
		const input = (await screen.findByLabelText('Deck name')) as HTMLInputElement;
		expect(input.value).toBe('Greetings');
		await fireEvent.input(input, { target: { value: '   ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
		expect(renameDeck).not.toHaveBeenCalled();
		expect((await screen.findByRole('alert')).textContent).toContain('name');
		await fireEvent.input(input, { target: { value: 'Hello' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
		expect(renameDeck).toHaveBeenCalledWith('d1', 'Hello');
		await screen.findByText('Renamed.');
	});

	it('asks before deleting, names where the cards go, and leaves for the list', async () => {
		render(DeckSettingsView, { deckId: 'd1' });
		await screen.findByLabelText('Deck name');
		await fireEvent.click(screen.getByRole('button', { name: 'Delete deck' }));
		const dialog = screen.getByRole('alertdialog');
		expect(dialog.textContent).toContain('Delete “Greetings”? Its 3 cards: 1 stays in Verbs, 2 move to General.');
		expect(deleteDeck).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete “Greetings”' }));
		await waitFor(() => expect(deleteDeck).toHaveBeenCalledWith('d1'));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/p/flashcards'));
	});

	it('Cancel closes the confirmation without deleting', async () => {
		render(DeckSettingsView, { deckId: 'd1' });
		await screen.findByLabelText('Deck name');
		await fireEvent.click(screen.getByRole('button', { name: 'Delete deck' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(deleteDeck).not.toHaveBeenCalled();
	});

	it('General can be configured but not renamed or deleted', async () => {
		render(DeckSettingsView, { deckId: 'general' });
		await screen.findByRole('heading', { level: 1, name: 'General settings' });
		expect(screen.queryByLabelText('Deck name')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Delete deck' })).toBeNull();
		expect(screen.getByRole('group', { name: 'Extra card types for General' })).toBeTruthy();
	});

	it('shows the card type switches of the deck and saves a change', async () => {
		vi.mocked(saveDeckCardTypes).mockResolvedValue({ deckId: 'd1', cardTypes: ['reverse', 'cloze'], extra: {} });
		render(DeckSettingsView, { deckId: 'd1' });
		const cloze = (await screen.findByLabelText(/Cloze/)) as HTMLInputElement;
		expect(cloze.checked).toBe(true);
		await fireEvent.click(screen.getByLabelText(/Reverse/));
		expect(saveDeckCardTypes).toHaveBeenCalledWith('d1', ['cloze', 'reverse']);
	});

	it('hides the limits section until an editor is plugged in, then renders it', async () => {
		const first = render(DeckSettingsView, { deckId: 'd1' });
		await screen.findByLabelText('Deck name');
		expect(screen.queryByRole('heading', { name: 'Daily limits' })).toBeNull();
		first.unmount();
		render(DeckSettingsView, { deckId: 'd1', limitsEditor: LimitsStub });
		await screen.findByLabelText('Deck name');
		expect(screen.getByRole('heading', { name: 'Daily limits' })).toBeTruthy();
		expect(screen.getByTestId('limits-stub').textContent).toBe('limits for d1 Greetings');
	});

	it('says when the deck does not exist', async () => {
		render(DeckSettingsView, { deckId: 'nope' });
		expect(await screen.findByText('Deck not found.')).toBeTruthy();
	});
});
