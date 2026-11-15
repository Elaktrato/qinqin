import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scheme } from '$lib/api/types';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/schemes', () => ({
	getSchemes: vi.fn(),
	getSchemeEntries: vi.fn(),
	fetchSchemeCharacters: vi.fn()
}));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	loadStudyData: vi.fn()
}));
vi.mock('$lib/components/CardManager.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/time/zone', () => ({
	currentStudyDay: vi.fn(),
	onStudyDayChange: vi.fn(() => () => {})
}));

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
