import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn(), invalidateStudyHistory: vi.fn() }));
vi.mock('$lib/api/entryBases', () => ({ loadEntryBases: vi.fn() }));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	deleteCards: vi.fn(),
	moveCards: vi.fn(),
	restoreCards: vi.fn(),
	dropSiblingCards: vi.fn(),
	skipKind: vi.fn(),
	unskipKind: vi.fn()
}));

import { loadEntryBases } from '$lib/api/entryBases';
import type { EntryBase } from '$lib/api/types';
import { loadStudyHistory } from '$lib/study/history';
import {
	deleteCards,
	dropSiblingCards,
	moveCards,
	restoreCards,
	skipKind,
	unskipKind
} from '$lib/study/store';
import { SESSION_CONFIG_KEY } from '$lib/study/session';
import type { Deck, StudyCard } from '$lib/study/types';
import { workspaces } from '$lib/workspaces';
import DeckDetail from './DeckDetail.svelte';

const verbs: Deck = { id: 'd1', name: 'Verbs', createdAt: '2026-01-01T00:00:00.000Z' };
const nouns: Deck = { id: 'd2', name: 'Nouns', createdAt: '2026-01-02T00:00:00.000Z' };
const WORDS = ['好', '喜欢', '你'];

function vocab(n: number, written: string, extra: Partial<StudyCard> = {}): StudyCard {
	return {
		id: `c-vocab-${n}`,
		kind: 'vocab',
		entryId: n,
		written,
		deckIds: ['d1'],
		createdAt: `2026-01-0${n}T00:00:00.000Z`,
		...extra
	};
}
const reverse1: StudyCard = {
	id: 'c-reverse-1',
	kind: 'reverse',
	entryId: 1,
	written: '好',
	deckIds: ['d1'],
	createdAt: '2026-01-01T00:00:01.000Z'
};

function base(id: number, written: string, value: string, plain: string): EntryBase {
	return { id, language: 'zh', kind: 'word', written, readings: [{ type: 'pinyin', value, plain, ord: 0 }], attrs: {}, radicalId: null };
}
const BASES = new Map([
	[1, base(1, '好', 'hǎo', 'hao3')],
	[2, base(2, '喜欢', 'xǐhuan', 'xi3huan')],
	[3, base(3, '你', 'nǐ', 'ni3')]
]);

// A tiny fake backend: the store mocks change `cards`, the history mock reads it.
let cards: StudyCard[];
let settings: Record<string, unknown>;

function install(): void {
	vi.mocked(loadStudyHistory).mockImplementation(async () => ({
		decks: [verbs, nouns],
		cards: structuredClone(cards),
		reviews: [],
		merged: 0,
		deckSettings: settings as never
	}));
	vi.mocked(loadEntryBases).mockImplementation(async (ids) => new Map(ids.filter((id) => BASES.has(id)).map((id) => [id, BASES.get(id)!])));
	vi.mocked(deleteCards).mockImplementation(async (ids) => {
		const entries = new Set(cards.filter((c) => ids.includes(c.id)).map((c) => c.entryId));
		const removed = cards.filter((c) => entries.has(c.entryId));
		cards = cards.filter((c) => !entries.has(c.entryId));
		return removed;
	});
	vi.mocked(moveCards).mockImplementation(async (ids, deckId) => {
		const entries = new Set(cards.filter((c) => ids.includes(c.id)).map((c) => c.entryId));
		const before = cards.filter((c) => entries.has(c.entryId));
		cards = cards.map((c) => (entries.has(c.entryId) ? { ...c, deckIds: [deckId] } : c));
		return before;
	});
	vi.mocked(restoreCards).mockImplementation(async (rows) => {
		const ids = new Set(rows.map((r) => r.id));
		cards = [...cards.filter((c) => !ids.has(c.id)), ...rows];
	});
	vi.mocked(dropSiblingCards).mockImplementation(async (ids) => {
		const dropped = cards.filter((c) => ids.includes(c.id));
		const prevVocab = cards.filter((c) => c.kind === 'vocab' && dropped.some((d) => d.entryId === c.entryId));
		cards = cards
			.filter((c) => !ids.includes(c.id))
			.map((c) => (prevVocab.some((p) => p.id === c.id) ? { ...c, skipKinds: ['reverse'] } : c));
		return [...prevVocab, ...dropped];
	});
	vi.mocked(unskipKind).mockImplementation(async (entryId) => {
		const prev = cards.filter((c) => c.kind === 'vocab' && c.entryId === entryId);
		cards = cards.map((c) => (c.kind === 'vocab' && c.entryId === entryId ? { ...c, skipKinds: undefined } : c));
		return prev;
	});
	vi.mocked(skipKind).mockResolvedValue([]);
}

beforeEach(() => {
	workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
	cards = [vocab(1, '好'), reverse1, vocab(2, '喜欢'), vocab(3, '你')];
	settings = { d1: { deckId: 'd1', cardTypes: ['reverse'], extra: {} } };
	install();
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function open(deckId = 'd1'): Promise<void> {
	render(DeckDetail, { deckId });
	await screen.findByRole('link', { name: '好' });
}
const wordRows = () => [...document.querySelectorAll('li[data-entry]')];
const written = () => wordRows().map((li) => li.getAttribute('data-entry'));

describe('DeckDetail', () => {
	it('shows the deck header with its numbers, Study and Settings', async () => {
		await open();
		expect(screen.getByRole('heading', { level: 1, name: 'Verbs' })).toBeTruthy();
		const header = screen.getByRole('region', { name: 'Verbs numbers' });
		expect(header.textContent).toContain('3 words');
		expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/p/flashcards/deck/d1/settings');
		await fireEvent.click(screen.getByRole('button', { name: 'Study' }));
		expect(JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY) as string)).toMatchObject({ mode: 'decks', deckIds: ['d1'] });
		expect(goto).toHaveBeenCalledWith('/study/session');
	});

	it('loads the history and the bases once per view', async () => {
		await open();
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(loadStudyHistory).toHaveBeenCalledTimes(1);
		expect(loadEntryBases).toHaveBeenCalledTimes(1);
	});

	it('links each word to its entry and names every checkbox', async () => {
		await open();
		expect(screen.getByRole('link', { name: '好' }).getAttribute('href')).toBe('/entry/1');
		expect(screen.getByRole('checkbox', { name: 'Select 喜欢' })).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'Select all 3 shown' })).toBeTruthy();
	});

	it('search narrows the rows after a short pause, by reading too, and announces the count', async () => {
		await open();
		expect(screen.getByText('3 of 3 words').getAttribute('aria-live')).toBe('polite');
		await fireEvent.input(screen.getByRole('searchbox', { name: 'Search words' }), { target: { value: 'xihuan' } });
		await waitFor(() => expect(written()).toEqual(['2']));
		expect(screen.getByText('1 of 3 words')).toBeTruthy();
	});

	it('filters by state, kind and due now', async () => {
		await open();
		await fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'reverse' } });
		expect(written()).toEqual(['1']);
		await fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'all' } });
		await fireEvent.change(screen.getByLabelText('State'), { target: { value: 'mature' } });
		expect(written()).toEqual([]);
		expect(screen.getByText('No words match.')).toBeTruthy();
		await fireEvent.change(screen.getByLabelText('State'), { target: { value: 'new' } });
		expect(written()).toEqual(['1', '2', '3']);
		await fireEvent.click(screen.getByLabelText('Due now'));
		expect(written()).toEqual([]);
	});

	it('renders 100 rows at a time', async () => {
		cards = Array.from({ length: 130 }, (_, i) => vocab(i + 1, `字${i + 1}`, { createdAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z` }));
		render(DeckDetail, { deckId: 'd1' });
		await screen.findByRole('button', { name: 'Show 30 more' });
		expect(wordRows()).toHaveLength(100);
		await fireEvent.click(screen.getByRole('button', { name: 'Show 30 more' }));
		expect(wordRows()).toHaveLength(130);
		expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
	});

	it('moves the selected words to another deck and undoes it', async () => {
		await open();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select 好' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select 喜欢' }));
		await fireEvent.change(screen.getByLabelText('Move to'), { target: { value: 'd2' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Move' }));
		await waitFor(() => expect(written()).toEqual(['3']));
		expect(moveCards).toHaveBeenCalledWith(['c-vocab-1', 'c-vocab-2'], 'd2');
		await fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
		await waitFor(() => expect(written()).toEqual(['1', '2', '3']));
		expect(vi.mocked(restoreCards).mock.calls[0][1]).toEqual({ onlyLive: true });
	});

	it('deletes after a confirmation and undoes it', async () => {
		await open();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select 你' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		const dialog = screen.getByRole('alertdialog');
		expect(dialog.textContent).toContain('Delete 1 word from every deck');
		expect(deleteCards).not.toHaveBeenCalled();
		await fireEvent.click(within(dialog).getByRole('button', { name: /^Delete 1 word/ }));
		await waitFor(() => expect(written()).toEqual(['1', '2']));
		await fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
		await waitFor(() => expect(written()).toEqual(['1', '2', '3']));
	});

	it('removes and restores a reverse card from a row', async () => {
		await open();
		const row = screen.getByRole('link', { name: '好' }).closest('li') as HTMLElement;
		expect(within(row).getByText('Reverse')).toBeTruthy();
		await fireEvent.click(within(row).getByRole('button', { name: 'Cards of 好' }));
		await fireEvent.click(within(row).getByRole('button', { name: 'Remove Reverse' }));
		expect(dropSiblingCards).toHaveBeenCalledWith(['c-reverse-1']);
		await waitFor(() => expect(within(row).getByText('Reverse off')).toBeTruthy());
		await fireEvent.click(within(row).getByRole('button', { name: 'Turn Reverse back on' }));
		expect(unskipKind).toHaveBeenCalledWith(1, 'reverse');
		await waitFor(() => expect(within(row).queryByText('Reverse off')).toBeNull());
	});

	it('offers Remove for a kind the deck enables even before its card exists', async () => {
		await open();
		const row = screen.getByRole('link', { name: '喜欢' }).closest('li') as HTMLElement;
		await fireEvent.click(within(row).getByRole('button', { name: 'Cards of 喜欢' }));
		await fireEvent.click(within(row).getByRole('button', { name: 'Remove Reverse' }));
		expect(skipKind).toHaveBeenCalledWith(2, 'reverse');
		expect(within(row).queryByRole('button', { name: 'Remove Cloze' })).toBeNull();
	});

	it('says when the deck does not exist', async () => {
		render(DeckDetail, { deckId: 'nope' });
		expect(await screen.findByText('Deck not found.')).toBeTruthy();
	});
});
