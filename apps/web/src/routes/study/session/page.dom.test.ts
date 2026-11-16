import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Scheme } from '$lib/api/types';
import type { ReviewEvent, StudyCard } from '$lib/study/types';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/entries', () => ({ getEntry: vi.fn() }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn() }));
vi.mock('$lib/api/audio', () => ({ resolveAudio: vi.fn(async () => ({})) }));
vi.mock('$lib/study/events', () => ({
	flushPendingReviews: vi.fn(async () => {}),
	recordReview: vi.fn(async () => {})
}));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	loadStudyData: vi.fn(),
	addCard: vi.fn()
}));
vi.mock('$lib/study/writing', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/writing')>()),
	usableChars: vi.fn()
}));
vi.mock('$lib/plugins/flashcards/cards/WritingCard.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/plugins/flashcards/cards/SentenceCard.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/plugins/flashcards/cards/ToneCard.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/plugins/flashcards/Mascot.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/time/zone', () => ({
	currentStudyDay: vi.fn(),
	currentStudyHistory: vi.fn(() => []),
	onStudyDayChange: vi.fn(() => () => {})
}));

import { getEntry } from '$lib/api/entries';
import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import { recordReview } from '$lib/study/events';
import { SESSION_CONFIG_KEY } from '$lib/study/session';
import { addCard, loadStudyData } from '$lib/study/store';
import { usableChars } from '$lib/study/writing';
import { studyDay } from '$lib/time/studyDay';
import { currentStudyDay } from '$lib/time/zone';
import { offline, resetOffline } from '$lib/pwa/offlineState';
import { workspaces } from '$lib/workspaces';
import Page from './+page.svelte';

const scheme = {
	id: 3,
	name: 'JLPT kanji',
	unit: 'character',
	language: 'ja',
	levels: [{ id: 31, ord: 1, name: 'N5' }]
} as Scheme;

function kanji(id: number, written: string): Entry {
	return {
		id,
		language: 'ja',
		kind: 'character',
		written,
		readings: [{ type: 'on', value: 'ニチ', plain: 'nichi', ord: 0 }],
		badges: [],
		variants: [],
		sentences: [],
		senses: [
			{
				dictionaryId: 1,
				dictionaryName: 'KANJIDIC',
				packId: 'k',
				license: 'x',
				attribution: 'x',
				gloss: 'sun'
			}
		]
	} as unknown as Entry;
}

const GLYPHS: Record<number, string> = { 11: '日', 12: '月', 13: '火' };

function configure(cardTypes: string[], newLimit = 20): void {
	sessionStorage.setItem(
		SESSION_CONFIG_KEY,
		JSON.stringify({
			mode: 'levels',
			schemeId: 3,
			levelName: 'N5',
			deckIds: ['general'],
			newLimit,
			reviewLimit: 100,
			cardTypes
		})
	);
}

function history(cards: StudyCard[], reviews: ReviewEvent[]): void {
	vi.mocked(loadStudyData).mockResolvedValue({ decks: [], cards, reviews, merged: 0 });
}

beforeEach(() => {
	vi.mocked(currentStudyDay).mockReturnValue(studyDay([]));
	vi.mocked(getSchemes).mockResolvedValue([scheme]);
	vi.mocked(getSchemeEntries).mockResolvedValue([
		{ id: 11, kind: 'character', written: '日' },
		{ id: 12, kind: 'character', written: '月' },
		{ id: 13, kind: 'character', written: '火' }
	] as never);
	vi.mocked(getEntry).mockImplementation(async (id: number) => kanji(id, GLYPHS[id] ?? '?'));
	vi.mocked(usableChars).mockImplementation(async (written: string) => [...written]);
	vi.mocked(addCard).mockImplementation(async (entryId, opts) => ({
		id: `c-${opts?.kind ?? 'vocab'}-${entryId}`,
		kind: opts?.kind ?? 'vocab',
		entryId,
		deckIds: ['general'],
		createdAt: new Date().toISOString()
	}));
	history([], []);
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

describe('character level session', () => {
	it('shows the glyph first, readings after the reveal, and grades into one card', async () => {
		configure(['vocab']);
		render(Page);
		expect(await screen.findByLabelText('Vocab card')).toBeTruthy();
		expect(screen.getByText('日')).toBeTruthy();
		expect(screen.queryByLabelText('Readings')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		expect(screen.getByLabelText('Readings')).toBeTruthy();
		expect(screen.getByText('sun')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: /Good/ }));
		await waitFor(() => expect(recordReview).toHaveBeenCalledTimes(1));
		expect(addCard).toHaveBeenCalledWith(
			11,
			expect.objectContaining({ kind: 'vocab', written: '日', entryKind: 'character' })
		);
		expect(recordReview).toHaveBeenCalledWith(1, 'c-vocab-11', 3, 'vocab', expect.anything());
	});

	it('starts with the writing item once recognition was reviewed on an earlier day', async () => {
		configure(['vocab', 'writing'], 1);
		const ts = new Date(Date.now() - 3 * 86_400_000).toISOString();
		history(
			[
				{
					id: 'c-vocab-11',
					kind: 'vocab',
					entryId: 11,
					written: '日',
					entryKind: 'character',
					deckIds: ['general'],
					createdAt: ts
				}
			],
			[
				{
					id: '01JTESTREVIEW0000000000001',
					workspaceId: 1,
					device: 'web',
					ts,
					type: 'review',
					payload: { cardId: 'c-vocab-11', mode: 'vocab', grade: 4 }
				}
			]
		);
		render(Page);
		expect(await screen.findByLabelText('Writing card')).toBeTruthy();
	});

	it('skips a writing item without stroke data and shows the next reserve item', async () => {
		configure(['writing'], 1);
		vi.mocked(usableChars).mockImplementation(async (written: string) =>
			written === '日' ? [] : [...written]
		);
		render(Page);
		expect(await screen.findByLabelText('Writing card')).toBeTruthy();
		await waitFor(() => expect(getEntry).toHaveBeenCalledWith(12));
		expect(addCard).not.toHaveBeenCalled();
	});

	it('runs a writing-only session', async () => {
		configure(['writing']);
		render(Page);
		expect(await screen.findByLabelText('Writing card')).toBeTruthy();
	});

	it('drops a character without glosses from a writing session and remembers it', async () => {
		configure(['writing'], 1);
		vi.mocked(getEntry).mockImplementation(async (id: number) => ({
			...kanji(id, GLYPHS[id] ?? '?'),
			senses: id === 11 ? [] : kanji(id, '?').senses
		}));
		render(Page);
		expect(await screen.findByLabelText('Writing card')).toBeTruthy();
		await waitFor(() => expect(getEntry).toHaveBeenCalledWith(12));
		expect(addCard).not.toHaveBeenCalled();
		expect(sessionStorage.getItem('qinqin.study.ineligible') ?? '').toContain('writing:11');
	});
});

describe('offline start', () => {
	function configureDecks(cardTypes: string[]): void {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({ mode: 'decks', schemeId: null, levelName: null, deckIds: ['general'], newLimit: 20, reviewLimit: 100, cardTypes })
		);
	}
	const word = (id: number): StudyCard => ({ id: `v${id}`, kind: 'vocab', entryId: id, written: '日', deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' });

	beforeEach(() => resetOffline());
	afterEach(() => resetOffline());

	it('says the workspace is not ready when nothing was saved', async () => {
		offline.update((s) => ({ ...s, online: false }));
		configureDecks(['vocab']);
		vi.mocked(loadStudyData).mockRejectedValue(new TypeError('Failed to fetch'));
		render(Page);
		expect(await screen.findByText("This workspace isn't ready for offline study yet. Open it once while online.")).toBeTruthy();
	});

	it('a level session offline says it needs a connection', async () => {
		offline.update((s) => ({ ...s, online: false }));
		configure(['vocab']);
		vi.mocked(getSchemes).mockRejectedValue(new TypeError('Failed to fetch'));
		render(Page);
		expect(await screen.findByText('Level sessions need a connection. Start a deck session instead.')).toBeTruthy();
	});

	it('studies saved real cards and notes that companion cards return online', async () => {
		offline.update((s) => ({ ...s, online: false }));
		configureDecks(['vocab', 'sentence']);
		history([word(11), word(12)], []);
		render(Page);
		expect(await screen.findByLabelText('Vocab card')).toBeTruthy();
		expect(screen.getByText('Companion cards return when you are online.')).toBeTruthy();
	});
});
