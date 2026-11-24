import { StudyDays } from '$lib/time/studyDays';
import type { MockInstance } from 'vitest';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
/** One rule object, as the session's StudyDays caches it. */
const SHARED_DAY = studyDayOf([]);
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scheme } from '$lib/api/types';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/schemes', () => ({
	getSchemes: vi.fn(),
	getSchemeEntries: vi.fn(),
	fetchSchemeCharacters: vi.fn()
}));
vi.mock('$lib/api/characters', () => ({ fetchCharacters: vi.fn() }));
vi.mock('$lib/api/frequency', () => ({ getFrequencyPacks: vi.fn(async () => []) }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	loadStudyData: vi.fn()
}));
vi.mock('$lib/study/commands/decks', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/commands/decks')>()),
	saveDeckCardTypesForDecks: vi.fn(),
	createDeck: vi.fn()
}));
const cardManager = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock('$lib/components/CardManager.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		cardManager.props.push(props);
		return {};
	}
}));

import { fetchCharacters } from '$lib/api/characters';
import { getFrequencyPacks } from '$lib/api/frequency';
import { goto } from '$app/navigation';
import { fireEvent } from '@testing-library/svelte';
import { fetchSchemeCharacters, getSchemeEntries, getSchemes } from '$lib/api/schemes';
import { createDeck, saveDeckCardTypesForDecks } from '$lib/study/commands/decks';
import { loadStudyData } from '$lib/study/data';
import { tick } from 'svelte';
import { studyDay } from '$lib/time/studyDay';
import { SESSION_CONFIG_KEY } from '$lib/study/session';
import { primaryActions } from '$lib/ui/testing/primary';
import Page from './+page.svelte';
import * as build from '$lib/testing/study';

// The session's StudyDays (record 0009): its methods, faked on the class.
let currentStudyDay!: MockInstance<StudyDays['day']>;
beforeEach(() => {
	currentStudyDay = vi.spyOn(StudyDays.prototype, 'day').mockImplementation((() => SHARED_DAY) as never);
	vi.spyOn(StudyDays.prototype, 'effectiveHistory').mockImplementation((() => []) as never);
	vi.spyOn(StudyDays.prototype, 'onChange').mockImplementation((() => () => {}) as never);
});

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
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

function setup(scheme: Scheme, cardTypes: string[]): void {
	sessionStorage.setItem(
		SESSION_CONFIG_KEY,
		JSON.stringify({
			mode: 'levels',
			schemeId: scheme.id,
			levelName: 'N5',
			deckIds: ['general'],
			newLimit: 20,
			reviewLimit: 100,
			cardTypes
		})
	);
	vi.mocked(getSchemes).mockResolvedValue([scheme]);
}

beforeEach(() => {
	vi.mocked(currentStudyDay).mockReturnValue(studyDay([]));
	vi.mocked(loadStudyData).mockResolvedValue({
		decks: [],
		cards: [],
		reviews: [],
		merged: 0
	});
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
	vi.clearAllMocks();
	sessionStorage.clear();
});

describe('study setup, level sessions', () => {
	it('has one primary Start; scheme, level and limits are base controls', async () => {
		setup(charScheme, ['vocab']);
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: /start/i }).className).toContain('primary');
		expect(screen.getByLabelText('Scheme', { selector: 'select' }).closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Level', { selector: 'select' }).closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('New cards').closest('.field')).toBeTruthy();
	});

	it('Study all starts a session that ignores the limits', async () => {
		setup(charScheme, ['vocab']);
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		const all = screen.getByRole('button', { name: 'Study all' });
		expect((all as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(all);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/study/session'));
		const config = JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY)!);
		expect(config.studyAll).toBe(true);
		expect(config.newLimit).toBe(20);
	});

	it('enables start for a character level with new items', async () => {
		setup(charScheme, ['vocab']);
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		const stats = document.querySelector('.stats');
		expect(stats?.textContent).toMatch(/3\s*characters in/);
		expect(stats?.textContent).toMatch(/3\s*new/);
		const start = screen.getByRole('button', { name: /start/i }) as HTMLButtonElement;
		expect(start.disabled).toBe(false);
		expect(screen.queryByText(/Nothing is due/)).toBeNull();
	});

	it('lets a writing-only character session start', async () => {
		setup(charScheme, ['writing']);
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		const start = screen.getByRole('button', { name: /start/i }) as HTMLButtonElement;
		expect(start.disabled).toBe(false);
	});

	it('warns about other kinds on a character level', async () => {
		setup(charScheme, ['vocab', 'sentence']);
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		expect(screen.getByText('Character levels study recognition and writing cards.')).toBeTruthy();
	});

	it('keeps word levels vocab-only', async () => {
		setup(wordScheme, ['writing']);
		vi.mocked(getSchemeEntries).mockResolvedValue([
			{ id: 1, kind: 'word', written: '日本' }
		] as never);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(screen.getByText(/Level sessions study vocab cards only/)).toBeTruthy());
		const start = screen.getByRole('button', { name: /start/i }) as HTMLButtonElement;
		expect(start.disabled).toBe(true);
	});

	it('shows "L of N learned" per level in the picker', async () => {
		setup(charScheme, ['vocab']);
		vi.mocked(fetchSchemeCharacters).mockResolvedValue([
			{ levelId: 31, name: 'N5', chars: new Set(['日', '月', '火', '水']) },
			{ levelId: 32, name: 'N4', chars: new Set(['木']) }
		]);
		vi.mocked(fetchCharacters).mockResolvedValue({
			count: 5,
			chars: ['日', '月', '火', '水', '木'].map((c, i) => ({ i: i + 1, c }))
		});
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [],
			cards: [
				{
					id: 'c-vocab-11',
					kind: 'vocab',
					entryId: 11,
					written: '日月',
					deckIds: ['general'],
					createdAt: '2025-01-01T00:00:00Z'
				}
			],
			reviews: build.strongReviews('c-vocab-11'),
			merged: 0
		});
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('option', { name: 'N5 — 2 of 4 learned' })).toBeTruthy();
		expect(screen.getByRole('option', { name: 'N4 — 0 of 1 learned' })).toBeTruthy();
	});

	it('disables a writing-only session when no glyph of the level has stroke data', async () => {
		setup(charScheme, ['writing']);
		vi.mocked(getSchemeEntries).mockResolvedValue([
			{ id: 11, kind: 'character', written: '気' },
			{ id: 12, kind: 'character', written: '毎' }
		] as never);
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		const start = screen.getByRole('button', { name: /start/i }) as HTMLButtonElement;
		expect(start.disabled).toBe(true);
		expect(screen.getByText(/Nothing to write here/)).toBeTruthy();
	});

	it('does not count stroke-less glyphs as new writing items but keeps recognition', async () => {
		setup(charScheme, ['vocab']);
		vi.mocked(getSchemeEntries).mockResolvedValue([
			{ id: 11, kind: 'character', written: '気' }
		] as never);
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		const start = screen.getByRole('button', { name: /start/i }) as HTMLButtonElement;
		expect(start.disabled).toBe(false);
	});
});

describe('study setup, reverse and cloze checkboxes', () => {
	function deckSetup(): void {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({
				mode: 'decks',
				schemeId: null,
				levelName: null,
				deckIds: ['general'],
				newLimit: 20,
				reviewLimit: 100,
				cardTypes: ['vocab']
			})
		);
		vi.mocked(getSchemes).mockResolvedValue([]);
	}

	function withSettings(cardTypes: string[]): void {
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0,
			deckSettings: { general: { deckId: 'general', cardTypes, extra: {} } }
		} as never);
	}

	const box = (name: RegExp) =>
		document.querySelector(`.types input[aria-describedby="type-${name.source}-info"]`) as HTMLInputElement | null;

	it('shows Reverse and Cloze once even when no deck enables them', async () => {
		deckSetup();
		render(Page, { context: ctx.context });
		await screen.findByText(/This session/);
		expect(box(/reverse/)).not.toBeNull();
		expect(box(/cloze/)).not.toBeNull();
		expect(box(/reverse/)!.checked).toBe(false);
		expect(box(/cloze/)!.checked).toBe(false);
	});

	it('shows the enabled kinds, checked by default', async () => {
		deckSetup();
		withSettings(['reverse']);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(box(/reverse/)).not.toBeNull());
		expect(box(/reverse/)!.checked).toBe(true);
		expect(box(/cloze/)!.checked).toBe(false);
	});

	it('the global Reverse checkbox enables it on every deck at once', async () => {
		deckSetup();
		withSettings([]);
		vi.mocked(saveDeckCardTypesForDecks).mockResolvedValue({
			saved: { general: { deckId: 'general', cardTypes: ['reverse'], extra: {} } },
			unreadable: []
		});
		render(Page, { context: ctx.context });
		await waitFor(() => expect(box(/reverse/)).not.toBeNull());
		await fireEvent.click(box(/reverse/)!);
		await waitFor(() =>
			expect(saveDeckCardTypesForDecks).toHaveBeenCalledWith(expect.anything(), 1, ['general'], 'reverse', true)
		);
		expect(box(/reverse/)!.checked).toBe(true);
	});

	it('a deck whose stored switches cannot be read is left out and the page says so (#167)', async () => {
		deckSetup();
		withSettings([]);
		vi.mocked(saveDeckCardTypesForDecks).mockResolvedValue({ saved: {}, unreadable: ['general'] });
		render(Page, { context: ctx.context });
		await waitFor(() => expect(box(/reverse/)).not.toBeNull());
		await fireEvent.click(box(/reverse/)!);
		expect(await screen.findByText(/saved by a newer version of qinqin/)).toBeTruthy();
	});

	it('starts unchecked after the learner unchecked it before in this workspace', async () => {
		deckSetup();
		withSettings(['reverse', 'cloze']);
		localStorage.setItem('qinqin.study.extraTypes', JSON.stringify({ '1': { cloze: false } }));
		render(Page, { context: ctx.context });
		await waitFor(() => expect(box(/cloze/)).not.toBeNull());
		expect(box(/reverse/)!.checked).toBe(true);
		expect(box(/cloze/)!.checked).toBe(false);
	});
});

describe('study setup, a workspace switch while a deck is created (#174)', () => {
	it('the deck lands in the workspace it was created in and never shows in the one switched to', async () => {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({ mode: 'decks', schemeId: null, levelName: null, deckIds: ['general'], newLimit: 20, reviewLimit: 100, cardTypes: ['vocab'] })
		);
		vi.mocked(getSchemes).mockResolvedValue([]);
		let finish: (d: unknown) => void = () => undefined;
		vi.mocked(createDeck).mockImplementation((() => new Promise((r) => (finish = r))) as never);
		render(Page, { context: ctx.context });
		const name = (await screen.findByLabelText('New deck')) as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Late deck' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
		expect(createDeck).toHaveBeenCalledWith(expect.anything(), 1, 'Late deck');
		ctx.session.workspaces.set({
			list: [{ id: 1, language: 'ja', name: 'ja' } as never, { id: 2, language: 'ja', name: 'ja2' } as never],
			current: { id: 2, language: 'ja', name: 'ja2' } as never
		});
		await waitFor(() => expect(loadStudyData).toHaveBeenCalledWith(expect.anything(), 2));
		finish({ id: 'dLate', name: 'Late deck', createdAt: '2026-11-23T00:00:00Z' });
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByText('Late deck')).toBeNull();
	});
});

describe('study setup on a vacation day', () => {
	it('shows the vacation banner and no start button', async () => {
		setup(charScheme, ['vocab']);
		const today = studyDay([]).today();
		const end = new Date(Date.parse(`${today}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0,
			vacations: [{ version: 1, id: 'V', start: today, end, scope: 'all', createdDay: today, createdAt: `${today}T00:00:00Z` }]
		});
		render(Page, { context: ctx.context });
		const banner = await screen.findByText(/Vacation until/);
		expect(banner.textContent).toMatch(/^Vacation until \d+ \w+/);
		expect(screen.queryByRole('button', { name: /start studying/i })).toBeNull();
	});
});

describe('study setup with rows this version cannot read (#167)', () => {
	it('shows the notice of the loaded workspace and still offers the session', async () => {
		setup(charScheme, ['vocab']);
		vi.mocked(loadStudyData).mockImplementation(async (_study, id) => {
			ctx.session.study.unreadable.record(id as number, { cards: 1 }, []);
			return { decks: [], cards: [], reviews: [], merged: 0 };
		});
		render(Page, { context: ctx.context });
		expect(await screen.findByText(/1 saved study item could not be read/)).toBeTruthy();
		expect(screen.getByRole('button', { name: /start studying/i })).toBeTruthy();
	});
});

describe('study start and the daily limits', () => {
	it('words the day with the limits applied', async () => {
		setup(charScheme, ['vocab']);
		render(Page, { context: ctx.context });
		expect((await screen.findByText(/^Today:/)).textContent).toBe('Today: 0 reviews and 3 new (daily limits applied)');
	});

	it('Study all stays available when the daily limits would stop a normal session', async () => {
		setup(charScheme, ['vocab']);
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [], cards: [], reviews: [], merged: 0,
			limits: { workspace: { new: 0, reviews: 0 }, decks: {} }
		});
		render(Page, { context: ctx.context });
		await screen.findByText(/characters in/);
		expect((screen.getByRole('button', { name: /start studying/i }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Study all' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('caps the new cards by the workspace limit', async () => {
		setup(charScheme, ['vocab']);
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [], cards: [], reviews: [], merged: 0,
			limits: { workspace: { new: 2 }, decks: {} }
		});
		render(Page, { context: ctx.context });
		expect((await screen.findByText(/^Today:/)).textContent).toBe('Today: 0 reviews and 2 new (daily limits applied)');
	});
});

describe('study setup, new-card order (#75)', () => {
	const jiten = {
		id: 3,
		packId: 'jiten-frequency',
		name: 'Jiten frequency list',
		version: '1',
		language: 'ja',
		license: 'CC BY-SA 4.0',
		attribution: 'Jiten'
	};
	const orderSelect = () => screen.getByLabelText('Order of new cards') as HTMLSelectElement;

	beforeEach(() => {
		vi.mocked(getSchemes).mockResolvedValue([]);
	});

	it('offers most frequent first with a pack and saves the choice', async () => {
		vi.mocked(getFrequencyPacks).mockResolvedValue([jiten] as never);
		render(Page, { context: ctx.context });
		await waitFor(() =>
			expect([...orderSelect().options].map((o) => o.textContent)).toContain(
				'Most frequent first (Jiten frequency list)'
			)
		);
		expect(orderSelect().value).toBe('random');
		await fireEvent.change(orderSelect(), { target: { value: 'frequency' } });
		await fireEvent.click(screen.getByRole('button', { name: /start/i }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/study/session'));
		expect(JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY)!).newOrder).toEqual({ by: 'frequency' });
	});

	it('starts random by default, with a seed that fixes the shuffle', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(orderSelect().options.length).toBeGreaterThan(1));
		await fireEvent.click(screen.getByRole('button', { name: /start/i }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/study/session'));
		const saved = JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY)!);
		expect(saved.newOrder).toBe('random');
		expect(Number.isInteger(saved.seed)).toBe(true);
	});

	it('a deleted deck in the saved setup does not make the orders mixed', async () => {
		vi.mocked(getFrequencyPacks).mockResolvedValue([jiten] as never);
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0,
			deckSettings: { general: { deckId: 'general', cardTypes: [], newOrder: { by: 'frequency' }, extra: {} } }
		} as never);
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({
				mode: 'decks',
				schemeId: null,
				levelName: null,
				deckIds: ['general', 'gone'],
				newLimit: 20,
				reviewLimit: 100,
				cardTypes: ['vocab'],
				newOrder: 'deck'
			})
		);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(orderSelect().options.length).toBeGreaterThan(2));
		expect(screen.queryByText('Your decks use different orders: in the order added.')).toBeNull();
	});

	it('without a pack: no frequency option and the hint', async () => {
		vi.mocked(getFrequencyPacks).mockResolvedValue([]);
		render(Page, { context: ctx.context });
		await screen.findByText(
			'No frequency list is installed for Japanese. An administrator can add one in Settings, Data; see Data and licences.'
		);
		expect([...orderSelect().options].map((o) => o.value)).toEqual(['random', 'deck', 'added']);
	});
});

describe('study setup, order of card types (#132)', () => {
	const typeOrderSelect = () => screen.getByLabelText('Order of card types') as HTMLSelectElement;

	beforeEach(() => {
		vi.mocked(getSchemes).mockResolvedValue([]);
	});

	it('offers Mixed (the default) and Grouped by type and saves the choice', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(typeOrderSelect()).toBeTruthy());
		expect([...typeOrderSelect().options].map((o) => [o.value, o.textContent])).toEqual([
			['mixed', 'Mixed'],
			['grouped', 'Grouped by type']
		]);
		expect(typeOrderSelect().value).toBe('mixed');
		await fireEvent.change(typeOrderSelect(), { target: { value: 'grouped' } });
		await fireEvent.click(screen.getByRole('button', { name: /start/i }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/study/session'));
		expect(JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY)!).typeOrder).toBe('grouped');
	});

	it('sits after the hints of the new-card order', async () => {
		vi.mocked(getFrequencyPacks).mockResolvedValue([]);
		render(Page, { context: ctx.context });
		const hint = await screen.findByText(
			'No frequency list is installed for Japanese. An administrator can add one in Settings, Data; see Data and licences.'
		);
		const select = typeOrderSelect();
		expect(hint.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('preselects the saved choice', async () => {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({
				mode: 'decks',
				schemeId: null,
				levelName: null,
				deckIds: ['general'],
				newLimit: 20,
				reviewLimit: 100,
				cardTypes: ['vocab'],
				typeOrder: 'grouped'
			})
		);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(typeOrderSelect().value).toBe('grouped'));
	});
});

describe('study setup and the study cache (#193)', () => {
	it('reloads its counts when the rows of the shown workspace change, not for another workspace', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(loadStudyData).toHaveBeenCalledTimes(1));
		// A row another device wrote in the second of the load arrives with the cache's follow-up round.
		vi.mocked(loadStudyData).mockResolvedValue({ decks: [], cards: [build.card({ id: 'late', entryId: 9 })], reviews: [], merged: 0 });
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
