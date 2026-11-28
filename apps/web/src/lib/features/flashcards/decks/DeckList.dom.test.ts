import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn(),
	invalidateStudyHistory: vi.fn()
}));
vi.mock('../commands/decks', async (importOriginal) => ({
	...(await importOriginal<typeof import('../commands/decks')>()),
	createDeck: vi.fn(),
	renameDeck: vi.fn(),
	deleteDeck: vi.fn()
}));

import { loadStudyHistory } from '$lib/studycore/data';
import { createDeck, deleteDeck, renameDeck } from '../commands/decks';
import { SESSION_CONFIG_KEY } from '../session/session';
import { defaultSetup } from '../setup/setup';
import type { Deck, ReviewEvent, StudyCard, StudyHistory } from '$lib/studycore/types';
import { primaryActions } from '$lib/ui/testing/primary';
import DeckList from './DeckList.svelte';
import { StudySetups } from '../setup/setupStore.svelte';
import * as build from '$lib/testing/study';

let ctx: TestContext = testContext();
let update: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	ctx = testContext();
	update = vi.spyOn(StudySetups.prototype, 'update');
});

const verbs: Deck = { id: 'd1', name: 'Verbs', createdAt: '2026-01-01T00:00:00.000Z' };

function card(n: number, deckIds: string[]): StudyCard {
	return build.card({ id: `c-vocab-${n}`, entryId: n, written: `w${n}`, deckIds, createdAt: `2026-01-0${n}T00:00:00.000Z` });
}
function review(cardId: string): ReviewEvent {
	return build.review({ cardId, id: `r-${cardId}`, device: 'd', ts: '2026-01-01T09:00:00.000Z' });
}
function history(over: Partial<StudyHistory> = {}): StudyHistory {
	return build.history({
		decks: [verbs],
		cards: [card(1, ['general']), card(2, ['d1']), card(3, ['d1'])],
		reviews: [review('c-vocab-1')],
		...over
	});
}

beforeEach(() => {
	ctx.session.workspaces.set({
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
	it('has one primary Study; rows are hairlines and the new-deck name a Field', async () => {
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('link', { name: 'Study' }).className).toContain('primary');
		expect(screen.getByRole('button', { name: 'Study Verbs' }).className).toContain('secondary');
		const row = screen.getByRole('link', { name: 'Verbs' }).closest('li') as HTMLElement;
		expect(screen.getByLabelText('New deck name').closest('.field')).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Overall' })).toBeTruthy();
	});

	it('shows loading, then the overall numbers and one row per deck', async () => {
		render(DeckList, { context: ctx.context });
		expect(screen.getByRole('status').textContent).toContain('Loading');
		await screen.findByRole('link', { name: 'Verbs' });
		const general = screen.getByRole('link', { name: 'General' });
		expect(general.getAttribute('href')).toBe('/flashcards/deck/general');
		expect(screen.getByRole('link', { name: 'Verbs' }).getAttribute('href')).toBe('/flashcards/deck/d1');
		const row = screen.getByRole('link', { name: 'Verbs' }).closest('li') as HTMLElement;
		expect(row.textContent).toContain('2 words · 2 cards');
		expect(within(row).getByText('0 due')).toBeTruthy();
		expect(within(row).getByText('2 new')).toBeTruthy();
		const panel = screen.getByRole('region', { name: 'Overall' });
		expect(panel.textContent).toContain('3');
	});

	it('loads the history once, not on every render (the load must not retrigger its own effect)', async () => {
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(loadStudyHistory).toHaveBeenCalledTimes(1);
	});

	it('ends with the section of level and plugin decks', async () => {
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		expect(await screen.findByRole('heading', { level: 2, name: 'Level decks' })).toBeTruthy();
	});

	it('gives each bar a text alternative', async () => {
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		const verbsRow = screen.getByRole('link', { name: 'Verbs' }).closest('li') as HTMLElement;
		expect(within(verbsRow).getByRole('img').getAttribute('aria-label')).toBe('2 words: 0 mastered, 0 studied');
		const generalRow = screen.getByRole('link', { name: 'General' }).closest('li') as HTMLElement;
		expect(within(generalRow).getByRole('img').getAttribute('aria-label')).toBe('1 word: 0 mastered, 1 studied');
	});

	it('lists General only when it holds cards', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ cards: [card(2, ['d1'])] }));
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		expect(screen.queryByRole('link', { name: 'General' })).toBeNull();
	});

	it('Study writes a session over this deck only and goes to the session', async () => {
		render(DeckList, { context: ctx.context });
		const study = await screen.findByRole('button', { name: 'Study Verbs' });
		await fireEvent.click(study);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/study/session'));
		const saved = JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY) as string);
		expect(saved).toMatchObject({ mode: 'decks', deckIds: ['d1'], cardTypes: ['vocab'], from: location.pathname });
		expect(goto).toHaveBeenCalledWith('/study/session');
		// A one-off start never narrows the saved setup (4.4a).
		expect(update).not.toHaveBeenCalled();
	});

	it('includes the opt-in kinds a deck enables and says more cards appear while studying', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ deckSettings: { d1: { deckId: 'd1', cardTypes: ['reverse'], extra: {} } } })
		);
		render(DeckList, { context: ctx.context });
		const row = (await screen.findByRole('link', { name: 'Verbs' })).closest('li') as HTMLElement;
		expect(row.textContent).toContain('+ reverse/cloze cards as you study');
		await fireEvent.click(within(row).getByRole('button', { name: 'Study Verbs' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/study/session'));
		expect(JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY) as string).cardTypes).toEqual(['vocab', 'reverse']);
	});

	it('studies the kinds of the saved setup: an unchecked Reverse is left out', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ deckSettings: { d1: { deckId: 'd1', cardTypes: ['reverse'], extra: {} } } })
		);
		vi.spyOn(StudySetups.prototype, 'of').mockReturnValue({
			setup: { ...defaultSetup(), unchecked: ['reverse'] },
			raw: null,
			loaded: true,
			known: true,
			saveError: null
		});
		render(DeckList, { context: ctx.context });
		const row = (await screen.findByRole('link', { name: 'Verbs' })).closest('li') as HTMLElement;
		await fireEvent.click(within(row).getByRole('button', { name: 'Study Verbs' }));
		expect(JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY) as string).cardTypes).toEqual(['vocab']);
	});

	it('links Settings per deck', async () => {
		render(DeckList, { context: ctx.context });
		const row = (await screen.findByRole('link', { name: 'Verbs' })).closest('li') as HTMLElement;
		expect(within(row).getByRole('link', { name: 'Settings for Verbs' }).getAttribute('href')).toBe(
			'/flashcards/deck/d1/settings'
		);
	});

	it('New deck creates and lists it', async () => {
		vi.mocked(createDeck).mockResolvedValue({ id: 'd2', name: 'Nouns', createdAt: '2026-02-01T00:00:00.000Z' });
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ decks: [verbs, { id: 'd2', name: 'Nouns', createdAt: '2026-02-01T00:00:00.000Z' }] })
		);
		await fireEvent.input(screen.getByLabelText('New deck name'), { target: { value: 'Nouns' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
		expect(createDeck).toHaveBeenCalledWith(expect.anything(), 1, 'Nouns');
		await screen.findByRole('link', { name: 'Nouns' });
	});

	it('after a workspace switch, the created deck does not reload the old workspace into the view (#174)', async () => {
		let finish: (d: unknown) => void = () => undefined;
		vi.mocked(createDeck).mockImplementation(() => new Promise((r) => (finish = r)) as never);
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		await fireEvent.input(screen.getByLabelText('New deck name'), { target: { value: 'Nouns' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
		expect(createDeck).toHaveBeenCalledWith(expect.anything(), 1, 'Nouns');
		ctx.session.workspaces.set({ list: [], current: { id: 2, language: 'zh', name: 'zh2' } as never });
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledWith(expect.anything(), 2, expect.anything()));
		vi.mocked(loadStudyHistory).mockClear();
		finish({ id: 'd2', name: 'Nouns', createdAt: '2026-02-01T00:00:00.000Z' });
		await new Promise((r) => setTimeout(r, 0));
		expect(vi.mocked(loadStudyHistory).mock.calls.filter(([, ws]) => ws === 1)).toEqual([]);
	});

	it('refuses an empty deck name', async () => {
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		await fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
		expect(createDeck).not.toHaveBeenCalled();
		expect((await screen.findByRole('alert')).textContent).toContain('name');
	});

	it('shows a load error with Try again', async () => {
		vi.mocked(loadStudyHistory).mockRejectedValueOnce(new Error('offline'));
		render(DeckList, { context: ctx.context });
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('Could not load your decks.');
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await screen.findByRole('link', { name: 'Verbs' });
	});

	it('asks for a workspace when none is selected', async () => {
		ctx.session.workspaces.set({ list: [], current: null });
		render(DeckList, { context: ctx.context });
		await waitFor(() => expect(screen.getByRole('status').textContent).toContain('workspace'));
	});
});

describe('DeckList daily limits and vacation', () => {
	it('shows what is left today beside due and new', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ limits: { workspace: { new: 1 }, decks: {} } })
		);
		render(DeckList, { context: ctx.context });
		const verbsRow = (await screen.findByRole('link', { name: 'Verbs' })).closest('li') as HTMLElement;
		expect(within(verbsRow).getByText('1 new · 0 reviews left today')).toBeTruthy();
	});

	it('shows nothing for an unlimited deck', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ limits: { workspace: { new: null, reviews: null }, decks: {} } })
		);
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		expect(document.querySelector('.left')).toBeNull();
	});

	it('says "On vacation" where the numbers are', async () => {
		const today = ctx.session.zone.day().today();
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({
				vacations: [{ version: 1, id: 'V', start: today, end: null, scope: 'all', createdDay: today, createdAt: `${today}T00:00:00Z` }]
			})
		);
		render(DeckList, { context: ctx.context });
		const verbsRow = (await screen.findByRole('link', { name: 'Verbs' })).closest('li') as HTMLElement;
		expect(within(verbsRow).getByText('On vacation')).toBeTruthy();
		expect(within(verbsRow).queryByText(/ due$/)).toBeNull();
	});
});

describe('DeckList Study (all decks)', () => {
	it('opens the study modal', async () => {
		render(DeckList, { context: ctx.context });
		await screen.findByRole('link', { name: 'Verbs' });
		const study = screen.getAllByRole('link', { name: 'Study' })[0];
		expect(study.getAttribute('href')).toBe('/study');
		await fireEvent.click(study);
		expect(ctx.session.studyModal.open).toBe(true);
	});
});

describe('DeckList rename and delete (moved from the study page)', () => {
	async function verbsRow(): Promise<HTMLElement> {
		render(DeckList, { context: ctx.context });
		return (await screen.findByRole('link', { name: 'Verbs' })).closest('li') as HTMLElement;
	}

	it('General can be neither renamed nor deleted', async () => {
		await verbsRow();
		const general = screen.getByRole('link', { name: 'General' }).closest('li') as HTMLElement;
		expect(within(general).queryByRole('button', { name: /Rename/ })).toBeNull();
		expect(within(general).queryByRole('button', { name: /Delete/ })).toBeNull();
	});

	it('renames a deck inline and reloads the list', async () => {
		vi.mocked(renameDeck).mockResolvedValue({ ...verbs, name: 'Actions' });
		const row = await verbsRow();
		await fireEvent.click(within(row).getByRole('button', { name: 'Rename Verbs' }));
		const field = within(row).getByLabelText('New name for Verbs') as HTMLInputElement;
		await fireEvent.input(field, { target: { value: '  Actions ' } });
		await fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(renameDeck).toHaveBeenCalledWith(ctx.session.study, 1, 'd1', 'Actions'));
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(2));
	});

	it('refuses an empty name', async () => {
		const row = await verbsRow();
		await fireEvent.click(within(row).getByRole('button', { name: 'Rename Verbs' }));
		await fireEvent.input(within(row).getByLabelText('New name for Verbs'), { target: { value: '   ' } });
		await fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
		expect(await within(row).findByRole('alert')).toHaveProperty('textContent', 'Deck name cannot be empty.');
		expect(renameDeck).not.toHaveBeenCalled();
	});

	it('deletes a deck after the same confirmation, and not without it', async () => {
		const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
		const row = await verbsRow();
		await fireEvent.click(within(row).getByRole('button', { name: 'Delete Verbs' }));
		expect(confirm).toHaveBeenCalledWith('Delete "Verbs"? Its cards stay in your other decks, or move to General.');
		expect(deleteDeck).not.toHaveBeenCalled();
		await fireEvent.click(within(row).getByRole('button', { name: 'Delete Verbs' }));
		await waitFor(() => expect(deleteDeck).toHaveBeenCalledWith(ctx.session.study, 1, 'd1'));
		confirm.mockRestore();
	});

	it('a failed delete says so', async () => {
		vi.spyOn(window, 'confirm').mockReturnValue(true);
		vi.mocked(deleteDeck).mockRejectedValue(new Error('down'));
		const row = await verbsRow();
		await fireEvent.click(within(row).getByRole('button', { name: 'Delete Verbs' }));
		expect((await screen.findByText('Could not delete the deck.'))).toBeTruthy();
	});
});
