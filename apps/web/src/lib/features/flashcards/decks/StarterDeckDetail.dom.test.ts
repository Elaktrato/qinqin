import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/frequency', () => ({ getFrequencyPacks: vi.fn(), getStarterEntries: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn(),
	invalidateStudyHistory: vi.fn(),
	loadRawStudyData: vi.fn()
}));
vi.mock('$lib/studycore/commands/write', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/commands/write')>()),
	pushStudy: vi.fn()
}));

import { getFrequencyPacks, getStarterEntries } from '$lib/api/frequency';
import { loadRawStudyData, loadStudyHistory } from '$lib/studycore/data';
import { pushStudy } from '$lib/studycore/commands/write';
import { toLegacy } from '$lib/testing/legacyCodec';
import { type StudyWrite } from '$lib/studycore/plan';

/** The typed writes as the legacy rows they stand for (test codec). */
function keyed(writes: readonly StudyWrite[]): { key: string; data: unknown; knownAt?: string }[] {
	return writes.map((w) => ({ ...toLegacy(w.collection, w.row), ...(w.knownAt === undefined ? {} : { knownAt: w.knownAt }) }));
}
import type { Deck, StudyCard } from '$lib/studycore/types';

import { primaryActions } from '$lib/ui/testing/primary';
import StarterDeckDetail from './StarterDeckDetail.svelte';
import * as build from '$lib/testing/study';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const jiten = {
	id: 3,
	packId: 'jiten-frequency',
	name: 'Jiten frequency list',
	version: '1',
	language: 'ja',
	license: 'CC BY-SA 4.0',
	attribution: 'Jiten'
};
const entry = (id: number) => ({
	id,
	language: 'ja',
	kind: 'word',
	written: `w${id}`,
	readings: [{ type: 'kana', value: `r${id}`, plain: `r${id}`, ord: 0 }],
	attrs: {},
	radicalId: null,
	rank: id * 10
});
const OWNED = 'd-frq-jiten-frequency-d4514a31';

// Entry 4 is known: its vocab card is strong.
let decks: Deck[];
let cards: StudyCard[];
let pushed: { key: string; data: unknown }[];
let settings: Record<string, { deckId: string; cardTypes: []; extra: Record<string, unknown> }>;

beforeEach(() => {
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'ja', name: 'ja' } as never],
		current: { id: 1, language: 'ja', name: 'ja' } as never
	});
	decks = [];
	cards = [
		{
			id: 'c-vocab-4',
			kind: 'vocab',
			entryId: 4,
			deckIds: ['general'],
			createdAt: '2025-01-01T00:00:00.000Z'
		}
	];
	pushed = [];
	settings = {};
	vi.mocked(getFrequencyPacks).mockResolvedValue([jiten]);
	vi.mocked(getStarterEntries).mockResolvedValue({
		packId: 'jiten-frequency',
		name: 'Jiten frequency list',
		size: 500,
		entries: [1, 2, 3, 4].map(entry)
	});
	vi.mocked(loadStudyHistory).mockImplementation(async () => ({
		decks: structuredClone(decks),
		cards: structuredClone(cards),
		reviews: build.strongReviews('c-vocab-4'),
		merged: 0
	}));
	vi.mocked(loadRawStudyData).mockImplementation(async () => ({
		decks: structuredClone(decks),
		cards: structuredClone(cards),
		knownAt: new Map(),
		stored: new Map(),
		unreadable: new Set<string>(),
		deckSettings: structuredClone(settings)
	}));
	vi.mocked(pushStudy).mockImplementation(async (_study, _ws, writes) => {
		for (const row of keyed(writes)) {
			pushed.push(row);
			if (row.key.startsWith('deck:')) decks.push(row.data as Deck);
			if (row.key.startsWith('card:')) cards.push(row.data as StudyCard);
			if (row.key.startsWith('deckcfg:')) {
				const id = row.key.slice('deckcfg:'.length);
				settings[id] = { deckId: id, cardTypes: [], extra: {} };
			}
		}
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const route = { view: 'system-frequency' as const, packId: 'jiten-frequency', size: 500 as const };

describe('StarterDeckDetail', () => {
	it('has one primary Add to my decks', async () => {
		render(StarterDeckDetail, { props: { route: { view: 'system-frequency', packId: 'jiten-frequency', size: 500 } }, context: ctx.context });
		await screen.findByRole('heading', { level: 1 });
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Add to my decks' }).className).toContain('primary');
	});

	it('lists the words with their state, skips the known ones, names the licence', async () => {
		render(StarterDeckDetail, { props: { route }, context: ctx.context });
		await screen.findByRole('heading', { name: 'Jiten frequency list · Top 500' });
		await screen.findByText('1 known word skipped');
		expect(screen.getByText('w1')).toBeTruthy();
		expect(screen.queryByText('w4')).toBeNull();
		expect(screen.getByText('From Jiten frequency list · CC BY-SA 4.0')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Data and licences' }).getAttribute('href')).toBe(
			'/sources'
		);
		expect(screen.queryByRole('button', { name: /Study/ })).toBeNull();
		expect(getStarterEntries).toHaveBeenCalledWith(3, 500);
	});

	it('adds the unknown words with the frequency order, then a second add adds nothing', async () => {
		render(StarterDeckDetail, { props: { route }, context: ctx.context });
		await screen.findByText('1 known word skipped');
		await fireEvent.click(screen.getByRole('button', { name: 'Add to my decks' }));
		await screen.findByText('Added 3 words; 1 you know was skipped');
		expect(pushed.map((r) => r.key)).toEqual([
			`deck:${OWNED}`,
			`deckcfg:${OWNED}`,
			'card:c-vocab-1',
			'card:c-vocab-2',
			'card:c-vocab-3'
		]);
		expect(pushed[1].data).toMatchObject({ deckId: OWNED, newOrder: { by: 'frequency' } });
		const open = await screen.findByRole('link', { name: 'Open my copy' });
		expect(open.getAttribute('href')).toBe(`/flashcards/deck/${OWNED}`);

		const before = pushed.length;
		await fireEvent.click(screen.getByRole('button', { name: 'Add to my decks' }));
		await screen.findByText('Nothing new to add to Jiten frequency list · Top 500');
		expect(pushed.length).toBe(before);
	});

	it('skips a word the learner marked known, card or not', async () => {
		const history = vi.mocked(loadStudyHistory).getMockImplementation()!;
		vi.mocked(loadStudyHistory).mockImplementation(async (_study, ws) => ({ ...(await history(_study, ws)), known: [2] }));
		render(StarterDeckDetail, { props: { route }, context: ctx.context });
		await screen.findByText('2 known words skipped');
		expect(screen.queryByText('w2')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Add to my decks' }));
		await screen.findByText(/Added 2 words/);
		expect(pushed.map((r) => r.key).filter((k) => k.startsWith('card:'))).toEqual(['card:c-vocab-1', 'card:c-vocab-3']);
	});

	it('never adds known words when the study data was not loaded yet', async () => {
		const history = vi.mocked(loadStudyHistory).getMockImplementation()!;
		vi.mocked(loadStudyHistory).mockRejectedValueOnce(new Error('offline'));
		render(StarterDeckDetail, { props: { route }, context: ctx.context });
		const button = await screen.findByRole('button', { name: 'Add to my decks' });
		vi.mocked(loadStudyHistory).mockImplementation(history);
		await fireEvent.click(button);
		await screen.findByText('Added 3 words; 1 you know was skipped');
		expect(pushed.map((r) => r.key)).not.toContain('card:c-vocab-4');
	});

	it('does not add when the study data cannot be loaded', async () => {
		vi.mocked(loadStudyHistory).mockRejectedValue(new Error('offline'));
		render(StarterDeckDetail, { props: { route }, context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Add to my decks' }));
		await screen.findByRole('alert');
		expect(pushed).toEqual([]);
	});

	it('an unknown pack is not found', async () => {
		render(StarterDeckDetail, { props: { route: { ...route, packId: 'nope' } }, context: ctx.context });
		await screen.findByText('Deck not found.');
	});
});
