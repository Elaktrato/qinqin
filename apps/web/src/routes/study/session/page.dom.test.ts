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
const { fakeCard } = vi.hoisted(() => ({
	fakeCard: async () => ({ default: (await import('$lib/testing/FakeCard.svelte')).default })
}));
vi.mock('$lib/features/flashcards/cards/WritingCard.svelte', fakeCard);
vi.mock('$lib/features/flashcards/cards/SentenceCard.svelte', fakeCard);
vi.mock('$lib/features/flashcards/cards/ToneCard.svelte', fakeCard);
vi.mock('$lib/features/flashcards/cards/ReverseCard.svelte', fakeCard);
vi.mock('$lib/features/flashcards/cards/ClozeCard.svelte', fakeCard);
vi.mock('$lib/api/segment', () => ({ segmentBatch: vi.fn(async () => []) }));
vi.mock('$lib/notes/store', () => ({
	loadNotes: vi.fn(async () => new Map()),
	loadNoteCfg: vi.fn(async () => ({ onAnswer: true, extra: {} }))
}));
vi.mock('$lib/features/flashcards/Mascot.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/time/zone', () => ({
	currentStudyDay: vi.fn(),
	currentStudyHistory: vi.fn(() => []),
	onStudyDayChange: vi.fn(() => () => {})
}));

import { getEntry } from '$lib/api/entries';
import { loadNoteCfg, loadNotes } from '$lib/notes/store';
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

describe('personal note on the answer side', () => {
	function configureDecks(cardTypes: string[]): void {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({ mode: 'decks', schemeId: null, levelName: null, deckIds: ['general'], newLimit: 20, reviewLimit: 100, cardTypes })
		);
	}
	const word = {
		id: 21,
		language: 'zh',
		kind: 'word',
		written: '日本',
		readings: [{ type: 'pinyin', value: 'rì běn', plain: 'riben', ord: 0 }],
		badges: [],
		variants: [],
		sentences: [{ id: 301, entryId: 21, hanzi: '我去日本。', pinyin: 'wo3 qu4 ri4 ben3', translation: 'I go to Japan.' }],
		senses: [{ dictionaryId: 1, dictionaryName: 'CC', packId: 'c', license: 'x', attribution: 'x', gloss: 'Japan' }]
	} as unknown as Entry;
	const cardOf = (kind: string): StudyCard =>
		({
			id: `c-${kind}-21`,
			kind,
			entryId: 21,
			written: '日本',
			deckIds: ['general'],
			createdAt: '2026-01-01T00:00:00.000Z',
			...(kind === 'sentence' ? { sentenceId: 301 } : {})
		}) as StudyCard;
	const NOTE = 'Sun + root <img src=x onerror=alert(1)>';

	beforeEach(() => {
		resetOffline();
		workspaces.set({
			list: [{ id: 2, language: 'zh', name: 'zh' } as never],
			current: { id: 2, language: 'zh', name: 'zh' } as never
		});
		vi.mocked(getEntry).mockResolvedValue(word);
		vi.mocked(usableChars).mockResolvedValue(['日', '本']);
		vi.mocked(loadNotes).mockResolvedValue(new Map([[21, NOTE]]));
		vi.mocked(loadNoteCfg).mockResolvedValue({ onAnswer: true, extra: {} });
	});
	afterEach(() => resetOffline());

	const LABELS: Record<string, string> = {
		vocab: 'Vocab card',
		reverse: 'Reverse card',
		cloze: 'Cloze card',
		sentence: 'Word Salad card',
		writing: 'Writing card',
		tone: 'Tone card'
	};

	it.each(['vocab', 'reverse', 'cloze', 'sentence', 'writing', 'tone'])(
		'%s: absent before the reveal, shown after it',
		async (kind) => {
			configureDecks([kind]);
			// Reverse and cloze are opt-in per deck and need the word's vocab card.
			const cards = kind === 'reverse' || kind === 'cloze' ? [cardOf('vocab'), cardOf(kind)] : [cardOf(kind)];
			vi.mocked(loadStudyData).mockResolvedValue({
				decks: [],
				cards,
				reviews: [],
				merged: 0,
				deckSettings: { general: { deckId: 'general', cardTypes: ['reverse', 'cloze'], extra: {} } }
			} as never);
			render(Page);
			expect(await screen.findByLabelText(LABELS[kind])).toBeTruthy();
			await waitFor(() => expect(loadNotes).toHaveBeenCalledWith(2));
			await new Promise((r) => setTimeout(r, 0));
			expect(screen.queryByRole('note', { name: 'Your note' })).toBeNull();
			await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
			const box = await screen.findByRole('note', { name: 'Your note' });
			expect(box.textContent).toContain(NOTE);
			expect(box.querySelector('img')).toBeNull();
		}
	);

	it('is absent when the workspace switched notes off', async () => {
		vi.mocked(loadNoteCfg).mockResolvedValue({ onAnswer: false, extra: {} });
		configureDecks(['vocab']);
		history([cardOf('vocab')], []);
		render(Page);
		expect(await screen.findByLabelText('Vocab card')).toBeTruthy();
		await waitFor(() => expect(loadNoteCfg).toHaveBeenCalledWith(2));
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('note', { name: 'Your note' })).toBeNull();
	});

	it('a failed notes load never blocks the session and shows no error', async () => {
		vi.mocked(loadNotes).mockRejectedValue(new Error('down'));
		configureDecks(['vocab']);
		history([cardOf('vocab')], []);
		render(Page);
		expect(await screen.findByLabelText('Vocab card')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('note', { name: 'Your note' })).toBeNull();
		expect(screen.queryByRole('alert')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /Good/ }));
		await waitFor(() => expect(recordReview).toHaveBeenCalledTimes(1));
	});

	it('the session does not wait for the notes', async () => {
		vi.mocked(loadNotes).mockReturnValue(new Promise(() => {}));
		configureDecks(['vocab']);
		history([cardOf('vocab')], []);
		render(Page);
		expect(await screen.findByLabelText('Vocab card')).toBeTruthy();
	});

	it('an offline session makes no notes request', async () => {
		offline.update((s) => ({ ...s, online: false }));
		configureDecks(['vocab']);
		history([cardOf('vocab')], []);
		render(Page);
		expect(await screen.findByLabelText('Vocab card')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		expect(loadNotes).not.toHaveBeenCalled();
		expect(loadNoteCfg).not.toHaveBeenCalled();
		expect(screen.queryByRole('note', { name: 'Your note' })).toBeNull();
	});
});
