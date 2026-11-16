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
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	loadStudyData: vi.fn()
}));
vi.mock('$lib/components/CardManager.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/time/zone', () => ({
	currentStudyDay: vi.fn(),
	currentStudyHistory: vi.fn(() => []),
	onStudyDayChange: vi.fn(() => () => {})
}));

import { fetchCharacters } from '$lib/api/characters';
import { getFrequencyPacks } from '$lib/api/frequency';
import { goto } from '$app/navigation';
import { fireEvent } from '@testing-library/svelte';
import { fetchSchemeCharacters, getSchemeEntries, getSchemes } from '$lib/api/schemes';
import { loadStudyData } from '$lib/study/store';
import { studyDay } from '$lib/time/studyDay';
import { currentStudyDay } from '$lib/time/zone';
import { workspaces } from '$lib/workspaces';
import { strongReviews } from '$lib/testing/reviews';
import { SESSION_CONFIG_KEY } from '$lib/study/session';
import Page from './+page.svelte';

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
	workspaces.set({
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
	it('enables start for a character level with new items', async () => {
		setup(charScheme, ['vocab']);
		render(Page);
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
		render(Page);
		await screen.findByText(/characters in/);
		const start = screen.getByRole('button', { name: /start/i }) as HTMLButtonElement;
		expect(start.disabled).toBe(false);
	});

	it('warns about other kinds on a character level', async () => {
		setup(charScheme, ['vocab', 'sentence']);
		render(Page);
		await screen.findByText(/characters in/);
		expect(screen.getByText('Character levels study recognition and writing cards.')).toBeTruthy();
	});

	it('keeps word levels vocab-only', async () => {
		setup(wordScheme, ['writing']);
		vi.mocked(getSchemeEntries).mockResolvedValue([
			{ id: 1, kind: 'word', written: '日本' }
		] as never);
		render(Page);
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
			reviews: strongReviews('c-vocab-11'),
			merged: 0
		});
		render(Page);
		expect(await screen.findByRole('option', { name: 'N5 — 2 of 4 learned' })).toBeTruthy();
		expect(screen.getByRole('option', { name: 'N4 — 0 of 1 learned' })).toBeTruthy();
	});

	it('disables a writing-only session when no glyph of the level has stroke data', async () => {
		setup(charScheme, ['writing']);
		vi.mocked(getSchemeEntries).mockResolvedValue([
			{ id: 11, kind: 'character', written: '気' },
			{ id: 12, kind: 'character', written: '毎' }
		] as never);
		render(Page);
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
		render(Page);
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

	it('shows no Reverse or Cloze checkbox when no selected deck enables them', async () => {
		deckSetup();
		render(Page);
		await screen.findByText(/This session/);
		expect(box(/reverse/)).toBeNull();
		expect(box(/cloze/)).toBeNull();
	});

	it('shows the enabled kinds, checked by default', async () => {
		deckSetup();
		withSettings(['reverse']);
		render(Page);
		await waitFor(() => expect(box(/reverse/)).not.toBeNull());
		expect(box(/reverse/)!.checked).toBe(true);
		expect(box(/cloze/)).toBeNull();
	});

	it('starts unchecked after the learner unchecked it before in this workspace', async () => {
		deckSetup();
		withSettings(['reverse', 'cloze']);
		localStorage.setItem('qinqin.study.extraTypes', JSON.stringify({ '1': { cloze: false } }));
		render(Page);
		await waitFor(() => expect(box(/cloze/)).not.toBeNull());
		expect(box(/reverse/)!.checked).toBe(true);
		expect(box(/cloze/)!.checked).toBe(false);
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
		render(Page);
		const banner = await screen.findByText(/Vacation until/);
		expect(banner.textContent).toMatch(/^Vacation until \d+ \w+/);
		expect(screen.queryByRole('button', { name: /start studying/i })).toBeNull();
	});
});

describe('study start and the daily limits', () => {
	it('words the day with the limits applied', async () => {
		setup(charScheme, ['vocab']);
		render(Page);
		expect((await screen.findByText(/^Today:/)).textContent).toBe('Today: 0 reviews and 3 new (daily limits applied)');
	});

	it('caps the new cards by the workspace limit', async () => {
		setup(charScheme, ['vocab']);
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [], cards: [], reviews: [], merged: 0,
			limits: { workspace: { new: 2 }, decks: {} }
		});
		render(Page);
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
		render(Page);
		await waitFor(() =>
			expect([...orderSelect().options].map((o) => o.textContent)).toContain(
				'Most frequent first (Jiten frequency list)'
			)
		);
		expect(orderSelect().value).toBe('deck');
		await fireEvent.change(orderSelect(), { target: { value: 'frequency' } });
		await fireEvent.click(screen.getByRole('button', { name: /start/i }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/study/session'));
		expect(JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY)!).newOrder).toEqual({ by: 'frequency' });
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
				cardTypes: ['vocab']
			})
		);
		render(Page);
		await waitFor(() => expect(orderSelect().options.length).toBeGreaterThan(2));
		expect(screen.queryByText('Your decks use different orders: in the order added.')).toBeNull();
	});

	it('without a pack: no frequency option and the hint', async () => {
		vi.mocked(getFrequencyPacks).mockResolvedValue([]);
		render(Page);
		await screen.findByText(
			'No frequency list is installed for Japanese. An administrator can add one in Settings, Data; see Data and licences.'
		);
		expect([...orderSelect().options].map((o) => o.value)).toEqual(['deck', 'added']);
	});
});
