import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	loadStudyHistory: vi.fn(),
	invalidateStudyHistory: vi.fn(),
	getStudyData: vi.fn(() => Promise.resolve({ decks: [], cards: [] }))
}));
vi.mock('$lib/study/commands/decks', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/commands/decks')>()),
	renameDeck: vi.fn(),
	deleteDeck: vi.fn(),
	saveDeckCardTypes: vi.fn(),
	saveDeckNewOrder: vi.fn()
}));
vi.mock('$lib/api/frequency', () => ({ getFrequencyPacks: vi.fn(async () => []) }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []) }));

import { loadStudyHistory } from '$lib/study/data';
import { getFrequencyPacks } from '$lib/api/frequency';
import { getSchemes } from '$lib/api/schemes';
import { deleteDeck, renameDeck, saveDeckCardTypes, saveDeckNewOrder } from '$lib/study/commands/decks';
import type { Deck, StudyCard } from '$lib/study/types';
import { workspaces } from '$lib/workspaces';
import { primaryActions } from '$lib/ui/testing/primary';
import DeckSettingsView from './DeckSettingsView.svelte';
import LimitsStub from './testing/LimitsStub.svelte';
import * as build from '$lib/testing/study';

const greetings: Deck = { id: 'd1', name: 'Greetings', createdAt: '2026-01-01T00:00:00.000Z' };
const verbs: Deck = { id: 'd2', name: 'Verbs', createdAt: '2026-01-02T00:00:00.000Z' };
function card(n: number, deckIds: string[]): StudyCard {
	return build.card({ id: `c-vocab-${n}`, entryId: n, deckIds });
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
	it('has one primary Save; the name and order are base underlines', async () => {
		render(DeckSettingsView, { deckId: 'd1' });
		await screen.findByRole('heading', { level: 1, name: 'Greetings settings' });
		const nameForm = screen.getByRole('button', { name: 'Save name' }).closest('form')!;
		expect(primaryActions(nameForm)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Save name' }).className).toContain('primary');
		expect(screen.getByLabelText('Deck name').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Order of new cards').closest('.field')).toBeTruthy();
	});

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
		expect(renameDeck).toHaveBeenCalledWith(1, 'd1', 'Hello');
		await screen.findByText('Renamed.');
	});

	it('renames in the workspace of the deck on screen, even when another was selected in the same moment (#174)', async () => {
		render(DeckSettingsView, { deckId: 'd1' });
		const input = (await screen.findByLabelText('Deck name')) as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Hello' } });
		const save = screen.getByRole('button', { name: 'Save name' });
		// The switch lands, and the click comes before the page reloaded for it.
		workspaces.set({ list: [], current: { id: 2, language: 'ja', name: 'ja' } as never });
		save.click();
		await waitFor(() => expect(renameDeck).toHaveBeenCalled());
		expect(vi.mocked(renameDeck).mock.calls[0][0]).toBe(1);
	});

	it('asks before deleting, names where the cards go, and leaves for the list', async () => {
		render(DeckSettingsView, { deckId: 'd1' });
		await screen.findByLabelText('Deck name');
		await fireEvent.click(screen.getByRole('button', { name: 'Delete deck' }));
		const dialog = screen.getByRole('alertdialog');
		expect(dialog.textContent).toContain('Delete “Greetings”? Its 3 cards: 1 stays in Verbs, 2 move to General.');
		expect(deleteDeck).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete “Greetings”' }));
		await waitFor(() => expect(deleteDeck).toHaveBeenCalledWith(1, 'd1'));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/flashcards'));
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
		expect(saveDeckCardTypes).toHaveBeenCalledWith(1, 'd1', ['cloze', 'reverse']);
	});

	it('renders the real daily limits editor by default, hides the section without one, and takes a stub', async () => {
		const first = render(DeckSettingsView, { deckId: 'd1' });
		await screen.findByLabelText('Deck name');
		expect(screen.getByRole('heading', { name: 'Daily limits' })).toBeTruthy();
		expect(await screen.findByRole('button', { name: 'Save limits' })).toBeTruthy();
		first.unmount();
		const none = render(DeckSettingsView, { deckId: 'd1', limitsEditor: null });
		await screen.findByLabelText('Deck name');
		expect(screen.queryByRole('heading', { name: 'Daily limits' })).toBeNull();
		none.unmount();
		render(DeckSettingsView, { deckId: 'd1', limitsEditor: LimitsStub });
		await screen.findByLabelText('Deck name');
		expect(screen.getByRole('heading', { name: 'Daily limits' })).toBeTruthy();
		expect(screen.getByTestId('limits-stub').textContent).toBe('limits for d1 Greetings');
	});

	it('says when the deck does not exist', async () => {
		render(DeckSettingsView, { deckId: 'nope' });
		expect(await screen.findByText('Deck not found.')).toBeTruthy();
	});

	describe('order of new cards (#75)', () => {
		const zhPack = {
			id: 4,
			packId: 'local-zh',
			name: 'Local zh list',
			version: '1',
			language: 'zh',
			license: 'local',
			attribution: 'local'
		};
		const hsk = { id: 7, name: 'HSK 3.0 (words)', unit: 'word', language: 'zh', packId: 'hsk-words', levels: [] };
		const select = () => screen.getByLabelText('Order of new cards') as HTMLSelectElement;

		beforeEach(() => {
			vi.mocked(getFrequencyPacks).mockResolvedValue([zhPack] as never);
			vi.mocked(getSchemes).mockResolvedValue([hsk] as never);
			vi.mocked(saveDeckNewOrder).mockImplementation(async (_ws, deckId, order) => ({
				deckId,
				cardTypes: ['cloze'],
				...(order.by === 'added' ? {} : { newOrder: order }),
				extra: {}
			}));
		});

		it('saves most frequent first and by level', async () => {
			render(DeckSettingsView, { deckId: 'd1' });
			await waitFor(() =>
				expect([...select().options].map((o) => o.textContent)).toEqual([
					'In the order added',
					'Most frequent first (Local zh list)',
					'By level: HSK 3.0 (words)'
				])
			);
			expect(select().value).toBe('added');
			await fireEvent.change(select(), { target: { value: 'frequency' } });
			await waitFor(() => expect(saveDeckNewOrder).toHaveBeenCalledWith(1, 'd1', { by: 'frequency' }));
			await fireEvent.change(select(), { target: { value: 'level:hsk-words' } });
			await waitFor(() =>
				expect(saveDeckNewOrder).toHaveBeenCalledWith(1, 'd1', { by: 'level', packId: 'hsk-words' })
			);
			expect(saveDeckCardTypes).not.toHaveBeenCalled();
		});

		it('shows the stored order', async () => {
			vi.mocked(loadStudyHistory).mockResolvedValue({
				decks: [greetings],
				cards: [],
				reviews: [],
				merged: 0,
				deckSettings: { d1: { deckId: 'd1', cardTypes: [], newOrder: { by: 'frequency' }, extra: {} } }
			});
			render(DeckSettingsView, { deckId: 'd1' });
			await waitFor(() => expect(select().value).toBe('frequency'));
		});

		it('without a pack: no frequency option and the hint', async () => {
			vi.mocked(getFrequencyPacks).mockResolvedValue([]);
			render(DeckSettingsView, { deckId: 'd1' });
			await screen.findByText(
				'No frequency list is installed for Chinese. An administrator can add one in Settings, Data; see Data and licences.'
			);
			expect([...select().options].map((o) => o.value)).toEqual(['added', 'level:hsk-words']);
		});

		it('keeps the select disabled on the stored order until both lists load', async () => {
			let release!: (v: never) => void;
			vi.mocked(getSchemes).mockReturnValue(new Promise((r) => (release = r)) as never);
			vi.mocked(loadStudyHistory).mockResolvedValue({
				decks: [greetings],
				cards: [],
				reviews: [],
				merged: 0,
				deckSettings: { d1: { deckId: 'd1', cardTypes: [], newOrder: { by: 'frequency' }, extra: {} } }
			});
			render(DeckSettingsView, { deckId: 'd1' });
			await waitFor(() => expect(select().value).toBe('frequency'));
			expect(select().disabled).toBe(true);
			release([hsk] as never);
			await waitFor(() => expect(select().disabled).toBe(false));
			expect(select().value).toBe('frequency');
		});

		it('shows a stored order whose list is gone as not available, and does not save it away', async () => {
			vi.mocked(getFrequencyPacks).mockResolvedValue([]);
			vi.mocked(loadStudyHistory).mockResolvedValue({
				decks: [greetings],
				cards: [],
				reviews: [],
				merged: 0,
				deckSettings: { d1: { deckId: 'd1', cardTypes: [], newOrder: { by: 'frequency' }, extra: {} } }
			});
			render(DeckSettingsView, { deckId: 'd1' });
			await waitFor(() => expect(select().disabled).toBe(false));
			expect(select().value).toBe('frequency');
			const gone = [...select().options].find((o) => o.value === 'frequency')!;
			expect(gone.textContent).toBe('Most frequent first (not available)');
			expect(gone.disabled).toBe(true);
			expect(saveDeckNewOrder).not.toHaveBeenCalled();
		});

		it('a failed list keeps the select disabled', async () => {
			vi.mocked(getFrequencyPacks).mockRejectedValue(new Error('offline'));
			render(DeckSettingsView, { deckId: 'd1' });
			await screen.findByText('Could not load the order choices. Try again later.');
			expect(select().disabled).toBe(true);
		});

		it('works for General', async () => {
			render(DeckSettingsView, { deckId: 'general' });
			await waitFor(() => expect(select().options.length).toBe(3));
			await fireEvent.change(select(), { target: { value: 'frequency' } });
			await waitFor(() => expect(saveDeckNewOrder).toHaveBeenCalledWith(1, 'general', { by: 'frequency' }));
		});
	});
});
