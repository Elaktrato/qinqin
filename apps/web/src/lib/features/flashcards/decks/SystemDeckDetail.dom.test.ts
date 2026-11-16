import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn() }));
vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn(), invalidateStudyHistory: vi.fn() }));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	loadRawStudyData: vi.fn(),
	pushStudy: vi.fn()
}));

import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import type { EntryBase, Scheme } from '$lib/api/types';
import { loadStudyHistory } from '$lib/study/history';
import { SESSION_CONFIG_KEY } from '$lib/study/session';
import { PartialPushError, loadRawStudyData, pushStudy } from '$lib/study/store';
import { toLegacy } from '$lib/study/testing/legacyCodec';
import type { StudyWrite } from '$lib/study/store';

/** The typed writes as the legacy rows they stand for (test codec). */
function keyed(writes: readonly StudyWrite[]): { key: string; data: unknown; knownAt?: string }[] {
	return writes.map((w) => ({ ...toLegacy(w.collection, w.row), ...(w.knownAt === undefined ? {} : { knownAt: w.knownAt }) }));
}
import type { Deck, ReviewEvent, StudyCard } from '$lib/study/types';
import { workspaces } from '$lib/workspaces';
import { clearLevelItemsCache } from './systemDeckItems';
import SystemDeckDetail from './SystemDeckDetail.svelte';

const SCHEME: Scheme = {
	id: 1,
	name: 'HSK words',
	unit: 'word',
	language: 'zh',
	packId: 'hsk-words',
	levels: [{ id: 11, ord: 1, name: 'HSK 1' }]
};
const DECK_ID = 'd-lvl-hsk-words-b06fd2ac';
const verbs: Deck = { id: 'd1', name: 'Verbs', createdAt: '2026-01-01T00:00:00.000Z' };

function entry(id: number): EntryBase {
	return { id, language: 'zh', kind: 'word', written: `词${id}`, readings: [], attrs: {}, radicalId: null };
}
const ITEMS = [entry(1), entry(2), entry(3)];

// The fake backend the store mocks read and write.
let decks: Deck[];
let cards: StudyCard[];
let reviews: ReviewEvent[];
let failAfter: number | null;
let knownAt: Map<string, string>;

function apply(rows: readonly { key: string; data: unknown }[]): void {
	for (const row of rows) {
		if (row.key.startsWith('deck:')) {
			decks = [...decks.filter((d) => d.id !== (row.data as Deck).id), row.data as Deck];
		} else {
			const card = row.data as StudyCard;
			cards = [...cards.filter((c) => c.id !== card.id), card];
		}
	}
}

beforeEach(() => {
	clearLevelItemsCache();
	workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
	decks = [verbs];
	cards = [{ id: 'c-vocab-1', kind: 'vocab', entryId: 1, written: '词1', deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' }];
	reviews = [
		{ id: 'r1', workspaceId: 1, device: 'd', ts: '2026-01-01T09:00:00.000Z', type: 'review', payload: { cardId: 'c-vocab-1', mode: 'vocab', grade: 3 } }
	];
	failAfter = null;
	knownAt = new Map();
	vi.mocked(getSchemes).mockResolvedValue([SCHEME]);
	vi.mocked(getSchemeEntries).mockResolvedValue(ITEMS);
	vi.mocked(loadStudyHistory).mockImplementation(async () => ({
		decks: structuredClone(decks),
		cards: structuredClone(cards),
		reviews,
		merged: 0
	}));
	vi.mocked(loadRawStudyData).mockImplementation(async () => ({
		decks: structuredClone(decks),
		cards: structuredClone(cards),
		knownAt: new Map(knownAt),
		stored: new Map()
	}));
	vi.mocked(pushStudy).mockImplementation(async (_ws, rows, opts) => {
		if (failAfter !== null) {
			const part = keyed(rows).slice(0, failAfter);
			apply(part);
			failAfter = null;
			throw new PartialPushError('Could not write the cards.', part.length);
		}
		apply(keyed(rows));
		opts?.onProgress?.(rows.length, rows.length);
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function open(): Promise<void> {
	render(SystemDeckDetail, { route: { view: 'system-level', packId: 'hsk-words', level: 'HSK 1' } });
	await screen.findByRole('heading', { level: 1, name: 'HSK words · HSK 1' });
}

describe('SystemDeckDetail', () => {
	it('lists the items with the learner state, or Not studied', async () => {
		await open();
		await screen.findByText('词1');
		const row1 = screen.getByText('词1').closest('li') as HTMLElement;
		expect(row1.textContent).toContain('Learning');
		expect((screen.getByText('词2').closest('li') as HTMLElement).textContent).toContain('Not studied');
		expect(screen.getByText('1 of 3 in your decks')).toBeTruthy();
	});

	it('Study starts a level session of this level', async () => {
		await open();
		await fireEvent.click(await screen.findByRole('button', { name: 'Study this level' }));
		expect(JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY) as string)).toMatchObject({
			mode: 'levels',
			schemeId: 1,
			levelName: 'HSK 1'
		});
		expect(goto).toHaveBeenCalledWith('/study/session');
	});

	it('adds the level into a new owned deck with the deterministic id, then says nothing new on the second add', async () => {
		await open();
		await fireEvent.click(await screen.findByRole('button', { name: 'Add to my decks' }));
		await screen.findByText('Added 3 words to HSK words · HSK 1');
		const rows = keyed(vi.mocked(pushStudy).mock.calls[0][1]);
		expect(rows.map((r) => r.key)).toEqual([
			`deck:${DECK_ID}`,
			'card:c-vocab-1',
			'card:c-vocab-2',
			'card:c-vocab-3'
		]);
		expect(decks.find((d) => d.id === DECK_ID)).toMatchObject({
			name: 'HSK words · HSK 1',
			source: { type: 'level', packId: 'hsk-words', level: 'HSK 1' }
		});
		// The word that was elsewhere joined; the new ones were created.
		expect(cards.find((c) => c.id === 'c-vocab-1')?.deckIds).toEqual(['general', DECK_ID]);

		await fireEvent.click(screen.getByRole('button', { name: 'Add to my decks' }));
		await screen.findByText('Nothing new to add to HSK words · HSK 1');
		expect(pushStudy).toHaveBeenCalledTimes(1);
	});

	it('adds into a chosen existing deck without writing a deck row', async () => {
		await open();
		await fireEvent.change(await screen.findByLabelText('Add to'), { target: { value: 'd1' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add to my decks' }));
		await screen.findByText('Added 3 words to Verbs');
		const keys = keyed(vi.mocked(pushStudy).mock.calls[0][1]).map((r) => r.key);
		expect(keys.some((k) => k.startsWith('deck:'))).toBe(false);
		expect(decks).toHaveLength(1);
	});

	it('a failure says how much landed and the retry adds only the rest', async () => {
		failAfter = 2; // the deck row and the first card
		await open();
		await fireEvent.click(await screen.findByRole('button', { name: 'Add to my decks' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('Added 1; try again to add the rest');
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await screen.findByText(/^Added 2 words to HSK words · HSK 1/);
		const retryRows = keyed(vi.mocked(pushStudy).mock.calls[1][1]).map((r) => r.key);
		expect(retryRows).toEqual(['card:c-vocab-2', 'card:c-vocab-3']);
	});

	it('a push the server partly refused offers one retry that re-plans from a fresh pull', async () => {
		const partly = new PartialPushError('2 rows were not written because the server holds newer data for them. Try again.', 1, 2);
		vi.mocked(pushStudy).mockRejectedValueOnce(partly);
		await open();
		await fireEvent.click(await screen.findByRole('button', { name: 'Add to my decks' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('2 rows were not written');
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await screen.findByText('Added 3 words to HSK words · HSK 1');
		expect(loadRawStudyData).toHaveBeenCalledTimes(2);
	});

	it('when the retry is skipped again it stops offering one that cannot help', async () => {
		const partly = new PartialPushError('2 rows were not written because the server holds newer data for them. Try again.', 1, 2);
		vi.mocked(pushStudy).mockRejectedValue(partly);
		await open();
		await fireEvent.click(await screen.findByRole('button', { name: 'Add to my decks' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull());
		expect(screen.getByRole('alert').textContent).toContain('keeps newer data');
	});

	it('hands the known server times of the rows to the writer', async () => {
		knownAt.set('cards:c-vocab-1', '2026-03-10T12:00:09.000Z');
		await open();
		await fireEvent.click(await screen.findByRole('button', { name: 'Add to my decks' }));
		await screen.findByText('Added 3 words to HSK words · HSK 1');
		const rows = keyed(vi.mocked(pushStudy).mock.calls[0][1]);
		expect(rows.find((r) => r.key === 'card:c-vocab-1')?.knownAt).toBe('2026-03-10T12:00:09.000Z');
		expect(rows.find((r) => r.key === 'card:c-vocab-2')?.knownAt).toBeUndefined();
	});

	it('refuses a target deck another tab removed, and never writes a deck row for it', async () => {
		await open();
		await fireEvent.change(await screen.findByLabelText('Add to'), { target: { value: 'd1' } });
		decks = []; // removed meanwhile
		await fireEvent.click(screen.getByRole('button', { name: 'Add to my decks' }));
		expect((await screen.findByRole('alert')).textContent).toContain('That deck was removed — pick another');
		expect(pushStudy).not.toHaveBeenCalled();
		expect((screen.getByLabelText('Add to') as HTMLSelectElement).value).toBe('new');
	});

	it('names an existing, maybe renamed, copy in the option and in the result', async () => {
		decks = [verbs, { id: DECK_ID, name: 'My HSK 1', createdAt: '2026-02-01T00:00:00.000Z' }];
		await open();
		const option = await screen.findByRole('option', { name: 'Existing copy: My HSK 1' });
		expect(option).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Add to my decks' }));
		await screen.findByText('Added 3 words to My HSK 1');
		const keys = keyed(vi.mocked(pushStudy).mock.calls[0][1]).map((r) => r.key);
		expect(keys.some((k) => k.startsWith('deck:'))).toBe(false);
		expect(decks.find((d) => d.id === DECK_ID)?.name).toBe('My HSK 1');
	});

	it('shows progress while adding', async () => {
		let release: () => void = () => {};
		vi.mocked(pushStudy).mockImplementationOnce(async (_ws, rows, opts) => {
			opts?.onProgress?.(2, rows.length);
			await new Promise<void>((resolve) => (release = resolve));
			apply(keyed(rows));
		});
		await open();
		await fireEvent.click(await screen.findByRole('button', { name: 'Add to my decks' }));
		expect((await screen.findByRole('status', { name: 'Adding' })).textContent).toBe('Adding 1 of 3…');
		release();
		await screen.findByText('Added 3 words to HSK words · HSK 1');
	});

	it('has no edit controls for the system deck itself', async () => {
		await open();
		await screen.findByText('词1');
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.queryByRole('button', { name: /delete|rename|remove/i })).toBeNull();
	});

	it('says when the level does not exist', async () => {
		render(SystemDeckDetail, { route: { view: 'system-level', packId: 'nope', level: 'x' } });
		expect(await screen.findByText('Deck not found.')).toBeTruthy();
	});

	it('a plugin deck nobody ships is not found', async () => {
		render(SystemDeckDetail, { route: { view: 'system-plugin', plugin: 'starter', key: 'k' } });
		expect(await screen.findByText('Deck not found.')).toBeTruthy();
		await waitFor(() => expect(getSchemeEntries).not.toHaveBeenCalled());
	});
});
