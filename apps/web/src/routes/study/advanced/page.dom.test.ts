import { StudyDays } from '$lib/time/studyDays';
import type { MockInstance } from 'vitest';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
/** One rule object, as the session's StudyDays caches it. */
const SHARED_DAY = studyDayOf([]);
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scheme } from '$lib/api/types';

const { goto } = vi.hoisted(() => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/schemes', () => ({
	getSchemes: vi.fn(),
	getSchemeEntries: vi.fn(),
	fetchSchemeCharacters: vi.fn()
}));
vi.mock('$lib/api/characters', () => ({ fetchCharacters: vi.fn() }));
vi.mock('$lib/api/frequency', () => ({ getFrequencyPacks: vi.fn(async () => []) }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyData: vi.fn()
}));
vi.mock('$lib/features/flashcards/commands/decks', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/flashcards/commands/decks')>()),
	saveDeckCardTypesForDecks: vi.fn()
}));
const cardManager = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock('$lib/features/flashcards/decks/CardManager.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		cardManager.props.push(props);
		return {};
	}
}));

import { fetchCharacters } from '$lib/api/characters';
import { getFrequencyPacks } from '$lib/api/frequency';
import { fetchSchemeCharacters, getSchemeEntries, getSchemes } from '$lib/api/schemes';
import { saveDeckCardTypesForDecks } from '$lib/features/flashcards/commands/decks';
import { loadStudyData } from '$lib/studycore/data';
import { defaultSetup, type StudySetup } from '$lib/features/flashcards/setup/setup';
import { StudySetups } from '$lib/features/flashcards/setup/setupStore.svelte';
import { tick } from 'svelte';
import { studyDay } from '$lib/time/studyDay';
import * as build from '$lib/testing/study';
import Page from './+page.svelte';

let currentStudyDay!: MockInstance<StudyDays['day']>;
let ctx: TestContext;
let saved: StudySetup;
let update: ReturnType<typeof vi.spyOn>;
/** When set, the rows API answers only once it resolves (a cold start). */
let rowsGate: Promise<void> | null = null;

beforeEach(() => {
	currentStudyDay = vi.spyOn(StudyDays.prototype, 'day').mockImplementation((() => SHARED_DAY) as never);
	vi.spyOn(StudyDays.prototype, 'effectiveHistory').mockImplementation((() => []) as never);
	vi.spyOn(StudyDays.prototype, 'onChange').mockImplementation((() => () => {}) as never);
	saved = defaultSetup();
	rowsGate = null;
	// The real store of the session over a fake rows API: what the page saves is what it reads back.
	const row = (ws: number) => ({ key: 'study-setup', userId: 1, workspaceId: ws, data: saved, version: 1, updatedAt: '2026-11-25T00:00:00Z', deletedAt: null });
	ctx = testContext({
		user: { id: 1 },
		routes: {
			'GET /api/rows': async (_body: unknown, path: string) => {
				if (rowsGate !== null) await rowsGate;
				return [row(Number(new URLSearchParams(path.split('?')[1]).get('workspace')))];
			},
			'PUT /api/rows/study-setup': (body: unknown, path: string) => {
				saved = body as StudySetup;
				return row(Number(new URLSearchParams(path.split('?')[1]).get('workspace')));
			}
		}
	});
	update = vi.spyOn(StudySetups.prototype, 'update');
});

const charScheme: Scheme = {
	id: 3,
	name: 'JLPT kanji',
	unit: 'character',
	language: 'ja',
	levels: [
		{ id: 31, ord: 1, name: 'N5' },
		{ id: 32, ord: 2, name: 'N4' }
	]
} as Scheme;
const wordScheme: Scheme = { ...charScheme, id: 4, name: 'JLPT vocab', unit: 'word' } as Scheme;

function setup(scheme: Scheme, cardTypes: StudySetup['cardTypes']): void {
	saved = { ...defaultSetup(), mode: 'levels', schemeId: scheme.id, levelName: 'N5', cardTypes };
	vi.mocked(getSchemes).mockResolvedValue([scheme]);
}

beforeEach(() => {
	vi.mocked(currentStudyDay).mockReturnValue(studyDay([]));
	vi.mocked(getSchemes).mockResolvedValue([]);
	vi.mocked(loadStudyData).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [], courseEvents: [] });
	vi.mocked(fetchSchemeCharacters).mockResolvedValue([]);
	vi.mocked(fetchCharacters).mockResolvedValue({ count: 0, chars: [] });
	vi.mocked(getSchemeEntries).mockImplementation(async () => {
		return [
			{ id: 11, kind: 'character', written: '日' },
			{ id: 12, kind: 'character', written: '月' },
			{ id: 13, kind: 'character', written: '火' }
		] as never;
	});
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'ja', name: 'ja' } as never],
		current: { id: 1, language: 'ja', name: 'ja' } as never
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.clearAllMocks();
	sessionStorage.clear();
	localStorage.clear();
});

const VERBS = { id: 'd1', name: 'Verbs', createdAt: '2026-01-01T00:00:00Z' };

describe('the advanced study setup', () => {
	it('is a page of the saved setup: no Start, no Study all, no deck management', async () => {
		render(Page, { context: ctx.context });
		await screen.findByRole('heading', { level: 1, name: 'Advanced settings' });
		await screen.findByLabelText('New cards');
		expect(screen.queryByRole('button', { name: /start studying/i })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Study all' })).toBeNull();
		expect(screen.queryByRole('button', { name: /Create deck/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
	});

	it('Back to study returns where the learner came from and opens the modal', async () => {
		history.replaceState(null, '', '/study/advanced?from=%2Fflashcards');
		render(Page, { context: ctx.context });
		const back = await screen.findByRole('link', { name: 'Back to study' });
		expect(back.getAttribute('href')).toBe('/flashcards');
		await fireEvent.click(back);
		expect(goto).toHaveBeenCalledWith('/flashcards');
		await waitFor(() => expect(ctx.session.studyModal.open).toBe(true));
		history.replaceState(null, '', '/');
	});

	it('a foreign return address is home', async () => {
		history.replaceState(null, '', '/study/advanced?from=https%3A%2F%2Fevil.example');
		render(Page, { context: ctx.context });
		expect((await screen.findByRole('link', { name: 'Back to study' })).getAttribute('href')).toBe('/');
		history.replaceState(null, '', '/');
	});

	it('waits for the saved setup on a cold start, then a change writes only its member (review blocker)', async () => {
		let release!: () => void;
		rowsGate = new Promise<void>((r) => (release = r));
		saved = { ...defaultSetup(), decks: ['general'], reviewLimit: 33, typeOrder: 'grouped' };
		render(Page, { context: ctx.context });
		await screen.findByRole('heading', { level: 1, name: 'Advanced settings' });
		await tick();
		expect(screen.queryByLabelText('New cards')).toBeNull();
		release();
		const field = (await screen.findByLabelText('New cards')) as HTMLInputElement;
		await fireEvent.change(field, { target: { value: '7' } });
		expect(update).toHaveBeenLastCalledWith(1, { newLimit: 7 });
		await waitFor(() => expect(saved).toMatchObject({ decks: ['general'], reviewLimit: 33, typeOrder: 'grouped', newLimit: 7 }));
	});

	it('saves a limit when it is changed, and refuses one out of range', async () => {
		render(Page, { context: ctx.context });
		const field = (await screen.findByLabelText('New cards')) as HTMLInputElement;
		await fireEvent.change(field, { target: { value: '7' } });
		expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ newLimit: 7 }));
		update.mockClear();
		await fireEvent.change(field, { target: { value: '1000' } });
		expect(update).not.toHaveBeenCalled();
		expect(await screen.findByText('New card limit must be a whole number from 1 to 999.')).toBeTruthy();
	});

	it('"All decks" is the live all; unticking a deck makes the list explicit', async () => {
		vi.mocked(loadStudyData).mockResolvedValue({ decks: [VERBS], cards: [], reviews: [], merged: 0, grammarRuns: [], courseEvents: [] });
		render(Page, { context: ctx.context });
		const all = (await screen.findByRole('checkbox', { name: 'All decks' })) as HTMLInputElement;
		expect(all.checked).toBe(true);
		const verbs = screen.getByRole('checkbox', { name: 'Verbs' }) as HTMLInputElement;
		expect(verbs.checked).toBe(true);
		await fireEvent.click(verbs);
		expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ decks: ['general'] }));
		await waitFor(() => expect((screen.getByRole('checkbox', { name: 'All decks' }) as HTMLInputElement).checked).toBe(false));
		// The last ticked deck stays ticked.
		expect((screen.getByRole('checkbox', { name: /^General/ }) as HTMLInputElement).disabled).toBe(true);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'All decks' }));
		expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ decks: 'all' }));
	});

	it('switching to levels picks the first scheme and level of the language', async () => {
		vi.mocked(getSchemes).mockResolvedValue([charScheme]);
		render(Page, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('radio', { name: 'By level' }));
		expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ mode: 'levels', schemeId: 3, levelName: 'N5' }));
	});

	it('a card type saves at once; the last one stays selected', async () => {
		render(Page, { context: ctx.context });
		const vocab = (await screen.findByRole('checkbox', { name: /^Vocab/ })) as HTMLInputElement;
		expect(vocab.disabled).toBe(true);
		await fireEvent.click(screen.getByRole('checkbox', { name: /^Writing/ }));
		expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ cardTypes: ['vocab', 'writing'] }));
	});

	it('links the scheduling page', async () => {
		render(Page, { context: ctx.context });
		expect((await screen.findByRole('link', { name: /^Scheduling:/ })).getAttribute('href')).toBe('/study/scheduling');
	});
});

describe('levels', () => {
	it('counts a character level', async () => {
		setup(charScheme, ['vocab']);
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		const stats = document.querySelector('.stats');
		expect(stats?.textContent).toMatch(/3\s*characters in/);
		expect(stats?.textContent).toMatch(/3\s*new/);
		expect(screen.queryByText(/Nothing is due/)).toBeNull();
	});

	it('warns about other kinds on a character level', async () => {
		setup(charScheme, ['vocab', 'sentence']);
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		expect(screen.getByText('Character levels study recognition and writing cards.')).toBeTruthy();
	});

	it('keeps word levels vocab-only', async () => {
		setup(wordScheme, ['writing']);
		vi.mocked(getSchemeEntries).mockResolvedValue([{ id: 1, kind: 'word', written: '日本' }] as never);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(screen.getAllByText(/Level sessions study vocab cards only/).length).toBeGreaterThan(0));
	});

	it('shows "L of N learned" per level in the picker', async () => {
		setup(charScheme, ['vocab']);
		vi.mocked(fetchSchemeCharacters).mockResolvedValue([
			{ levelId: 31, name: 'N5', chars: new Set(['日', '月', '火', '水']) },
			{ levelId: 32, name: 'N4', chars: new Set(['木']) }
		]);
		vi.mocked(fetchCharacters).mockResolvedValue({ count: 5, chars: ['日', '月', '火', '水', '木'].map((c, i) => ({ i: i + 1, c })) });
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [],
			cards: [build.card({ id: 'c-vocab-11', kind: 'vocab', entryId: 11, written: '日月', deckIds: ['general'], createdAt: '2025-01-01T00:00:00Z' })],
			reviews: build.strongReviews('c-vocab-11'),
			merged: 0, grammarRuns: [], courseEvents: []
		});
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('option', { name: 'N5 — 2 of 4 learned' })).toBeTruthy();
		expect(screen.getByRole('option', { name: 'N4 — 0 of 1 learned' })).toBeTruthy();
	});

	it('says nothing can be written when no glyph of the level has stroke data', async () => {
		setup(charScheme, ['writing']);
		vi.mocked(getSchemeEntries).mockResolvedValue([
			{ id: 11, kind: 'character', written: '気' },
			{ id: 12, kind: 'character', written: '毎' }
		] as never);
		render(Page, { context: ctx.context });
		expect(await screen.findByText(/Nothing to write here/)).toBeTruthy();
	});

	it('a chosen level saves scheme and level', async () => {
		setup(charScheme, ['vocab']);
		render(Page, { context: ctx.context });
		const level = (await screen.findByLabelText('Level', { selector: 'select' })) as HTMLSelectElement;
		await fireEvent.change(level, { target: { value: 'N4' } });
		expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ mode: 'levels', schemeId: 3, levelName: 'N4' }));
	});
});

describe('reverse and cloze', () => {
	function withSettings(cardTypes: ('reverse' | 'cloze')[]): void {
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0, grammarRuns: [], courseEvents: [],
			deckSettings: { general: { deckId: 'general', cardTypes, extra: {} } }
		} as never);
	}
	const box = (name: string) => document.querySelector(`.types input[aria-describedby="type-${name}-info"]`) as HTMLInputElement | null;

	it('shows Reverse and Cloze even when no deck enables them', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(box('reverse')).not.toBeNull());
		expect(box('reverse')!.checked).toBe(false);
		expect(box('cloze')!.checked).toBe(false);
	});

	it('shows the enabled kinds, checked unless the learner unchecked them', async () => {
		withSettings(['reverse', 'cloze']);
		saved = { ...defaultSetup(), unchecked: ['cloze'] };
		render(Page, { context: ctx.context });
		await waitFor(() => expect(box('reverse')!.checked).toBe(true));
		expect(box('cloze')!.checked).toBe(false);
	});

	it('the global Reverse checkbox enables it on every deck at once and clears the uncheck', async () => {
		withSettings([]);
		saved = { ...defaultSetup(), unchecked: ['reverse'] };
		vi.mocked(saveDeckCardTypesForDecks).mockResolvedValue({
			saved: { general: { deckId: 'general', cardTypes: ['reverse'], extra: {} } },
			unreadable: []
		});
		render(Page, { context: ctx.context });
		await waitFor(() => expect(box('reverse')).not.toBeNull());
		await fireEvent.click(box('reverse')!);
		await waitFor(() => expect(saveDeckCardTypesForDecks).toHaveBeenCalledWith(expect.anything(), 1, ['general'], 'reverse', true));
		expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ unchecked: [] }));
		await waitFor(() => expect(box('reverse')!.checked).toBe(true));
	});

	it('a deck whose stored switches cannot be read is left out and the page says so (#167)', async () => {
		withSettings([]);
		vi.mocked(saveDeckCardTypesForDecks).mockResolvedValue({ saved: {}, unreadable: ['general'] });
		render(Page, { context: ctx.context });
		await waitFor(() => expect(box('reverse')).not.toBeNull());
		await fireEvent.click(box('reverse')!);
		expect(await screen.findByText(/saved by a newer version of qinqin/)).toBeTruthy();
	});

	it('a switch while it saves writes to the workspace it was clicked in (#174)', async () => {
		withSettings([]);
		let finish: (v: unknown) => void = () => undefined;
		vi.mocked(saveDeckCardTypesForDecks).mockImplementation((() => new Promise((r) => (finish = r))) as never);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(box('reverse')).not.toBeNull());
		await fireEvent.click(box('reverse')!);
		ctx.session.workspaces.set({
			list: [{ id: 1, language: 'ja', name: 'ja' } as never, { id: 2, language: 'ja', name: 'ja2' } as never],
			current: { id: 2, language: 'ja', name: 'ja2' } as never
		});
		await waitFor(() => expect(loadStudyData).toHaveBeenCalledWith(expect.anything(), 2));
		finish({ saved: {}, unreadable: [] });
		expect(saveDeckCardTypesForDecks).toHaveBeenCalledWith(expect.anything(), 1, ['general'], 'reverse', true);
		expect(update.mock.calls.every((call: unknown[]) => call[0] === 1)).toBe(true);
	});
});

describe('the day', () => {
	it('words the day with the limits applied', async () => {
		setup(charScheme, ['vocab']);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(screen.getByText(/^Today:/).textContent).toBe('Today: 0 reviews and 3 new (daily limits applied)'));
	});

	it('caps the new cards by the workspace limit', async () => {
		setup(charScheme, ['vocab']);
		vi.mocked(loadStudyData).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [], courseEvents: [], limits: { workspace: { new: 2 }, decks: {} } });
		render(Page, { context: ctx.context });
		await waitFor(() => expect(screen.getByText(/^Today:/).textContent).toBe('Today: 0 reviews and 2 new (daily limits applied)'));
	});

	it('shows the vacation banner on a vacation day', async () => {
		const today = studyDay([]).today();
		const end = new Date(Date.parse(`${today}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0, grammarRuns: [], courseEvents: [],
			vacations: [{ version: 1, id: 'V', start: today, end, scope: 'all', createdDay: today, createdAt: `${today}T00:00:00Z` }]
		});
		render(Page, { context: ctx.context });
		expect((await screen.findByText(/Vacation until/)).textContent).toMatch(/^Vacation until \d+ \w+/);
		expect(screen.queryByText(/^Today:/)).toBeNull();
	});

	it('shows the notice of rows this version cannot read (#167)', async () => {
		vi.mocked(loadStudyData).mockImplementation(async (_study, id) => {
			ctx.session.study.unreadable.record(id as number, { cards: 1 }, []);
			return { decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [], courseEvents: [] };
		});
		render(Page, { context: ctx.context });
		expect(await screen.findByText(/1 saved study item could not be read/)).toBeTruthy();
	});
});

describe('orders', () => {
	const jiten = { id: 3, packId: 'jiten-frequency', name: 'Jiten frequency list', version: '1', language: 'ja', license: 'CC BY-SA 4.0', attribution: 'Jiten' };
	const orderSelect = () => screen.getByLabelText('Order of new cards') as HTMLSelectElement;
	const typeOrderSelect = () => screen.getByLabelText('Order of card types') as HTMLSelectElement;

	it('offers most frequent first with a pack and saves the choice', async () => {
		vi.mocked(getFrequencyPacks).mockResolvedValue([jiten] as never);
		render(Page, { context: ctx.context });
		await waitFor(() => expect([...orderSelect().options].map((o) => o.textContent)).toContain('Most frequent first (Jiten frequency list)'));
		expect(orderSelect().value).toBe('random');
		await fireEvent.change(orderSelect(), { target: { value: 'frequency' } });
		expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ newOrder: { by: 'frequency' } }));
	});

	it('a deleted deck in the saved setup does not make the orders mixed', async () => {
		vi.mocked(getFrequencyPacks).mockResolvedValue([jiten] as never);
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0, grammarRuns: [], courseEvents: [],
			deckSettings: { general: { deckId: 'general', cardTypes: [], newOrder: { by: 'frequency' }, extra: {} } }
		} as never);
		saved = { ...defaultSetup(), decks: ['general', 'gone'], newOrder: 'deck' };
		render(Page, { context: ctx.context });
		await waitFor(() => expect(orderSelect().options.length).toBeGreaterThan(2));
		expect(screen.queryByText('Your decks use different orders: in the order added.')).toBeNull();
	});

	it('without a pack: no frequency option and the hint, then the type order', async () => {
		vi.mocked(getFrequencyPacks).mockResolvedValue([]);
		render(Page, { context: ctx.context });
		const hint = await screen.findByText('No frequency list is installed for Japanese. An administrator can add one in Settings, Data; see Data and licences.');
		expect([...orderSelect().options].map((o) => o.value)).toEqual(['random', 'deck', 'added']);
		expect(hint.compareDocumentPosition(typeOrderSelect()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('offers Mixed and Grouped by type, preselects the saved one and saves a change', async () => {
		saved = { ...defaultSetup(), typeOrder: 'grouped' };
		render(Page, { context: ctx.context });
		await waitFor(() => expect(typeOrderSelect().value).toBe('grouped'));
		expect([...typeOrderSelect().options].map((o) => [o.value, o.textContent])).toEqual([
			['mixed', 'Mixed'],
			['grouped', 'Grouped by type']
		]);
		await fireEvent.change(typeOrderSelect(), { target: { value: 'mixed' } });
		expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ typeOrder: 'mixed' }));
	});
});

describe('the study cache (#193)', () => {
	it('reloads its counts when the rows of the shown workspace change, not for another workspace', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(loadStudyData).toHaveBeenCalledTimes(1));
		vi.mocked(loadStudyData).mockResolvedValue({ decks: [], cards: [build.card({ id: 'late', entryId: 9 })], reviews: [], merged: 0, grammarRuns: [], courseEvents: [] });
		ctx.session.study.cache.markStale(2);
		await tick();
		expect(loadStudyData).toHaveBeenCalledTimes(1);
		ctx.session.study.cache.markStale(1);
		await waitFor(() => expect(loadStudyData).toHaveBeenCalledTimes(2));
	});

	it("leaves the card manager's reloads to onStudyChange: one reload per change, not two", async () => {
		cardManager.props.length = 0;
		render(Page, { context: ctx.context });
		await waitFor(() => expect(cardManager.props.length).toBeGreaterThan(0));
		expect(cardManager.props.at(-1)?.onchanged).toBeUndefined();
	});
});

describe('per-deck switches', () => {
	it('lists every deck with its own switches', async () => {
		vi.mocked(loadStudyData).mockResolvedValue({ decks: [VERBS], cards: [], reviews: [], merged: 0, grammarRuns: [], courseEvents: [] });
		render(Page, { context: ctx.context });
		const toggle = await screen.findByRole('button', { name: 'Per-deck card types' });
		await fireEvent.click(toggle);
		const list = document.querySelector('.advanced-decks') as HTMLElement;
		expect(within(list).getByText('Verbs')).toBeTruthy();
	});
});
