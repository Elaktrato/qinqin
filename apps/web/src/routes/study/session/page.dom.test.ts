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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_W } from '$lib/study/fsrs/params';
import { shortInterval } from '$lib/study/intervalText';
import { scheduleFor } from '$lib/study/scheduler';
import { IDENTITY_CLOCK } from '$lib/study/studyClock';

// The generated preview of a new card with the default weights (#101): never adjusted to the test.
const NEW_CARD = (
	JSON.parse(
		readFileSync(resolve(__dirname, '../../../../../../docs/contracts/scheduler/next-intervals.json'), 'utf8')
	) as { cases: { name: string; expected: { grade: number; ms: number }[] }[] }
).cases.find((c) => c.name === 'a new card')!.expected;

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
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
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
		expect(await screen.findByLabelText('Write card')).toBeTruthy();
	});

	it('skips a writing item without stroke data and shows the next reserve item', async () => {
		configure(['writing'], 1);
		vi.mocked(usableChars).mockImplementation(async (written: string) =>
			written === '日' ? [] : [...written]
		);
		render(Page);
		expect(await screen.findByLabelText('Write card')).toBeTruthy();
		await waitFor(() => expect(getEntry).toHaveBeenCalledWith(12));
		expect(addCard).not.toHaveBeenCalled();
	});

	it('runs a writing-only session', async () => {
		configure(['writing']);
		render(Page);
		expect(await screen.findByLabelText('Write card')).toBeTruthy();
	});

	it('drops a character without glosses from a writing session and remembers it', async () => {
		configure(['writing'], 1);
		vi.mocked(getEntry).mockImplementation(async (id: number) => ({
			...kanji(id, GLYPHS[id] ?? '?'),
			senses: id === 11 ? [] : kanji(id, '?').senses
		}));
		render(Page);
		expect(await screen.findByLabelText('Write card')).toBeTruthy();
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
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
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
		vocab: 'Recognise card',
		reverse: 'Recall card',
		cloze: 'Fill the gap card',
		sentence: 'Build the sentence card',
		writing: 'Write card',
		tone: 'Tones card'
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
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
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
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
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
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
	});

	it('an offline session makes no notes request', async () => {
		offline.update((s) => ({ ...s, online: false }));
		configureDecks(['vocab']);
		history([cardOf('vocab')], []);
		render(Page);
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		expect(loadNotes).not.toHaveBeenCalled();
		expect(loadNoteCfg).not.toHaveBeenCalled();
		expect(screen.queryByRole('note', { name: 'Your note' })).toBeNull();
	});
});

describe('session states keep the page outline (#101)', () => {
	it('the no-workspace state still has an h1', async () => {
		configure(['vocab']);
		workspaces.set({ list: [], current: null });
		render(Page);
		const h1 = await screen.findByRole('heading', { level: 1 });
		expect(h1.textContent).toBe('Session');
		expect(h1.classList.contains('visually-hidden')).toBe(true);
	});
});

describe('the open page (#101)', () => {
	function shown(): string[] {
		return screen.getAllByRole('button').filter((b) => b.closest('[role="group"]')).map((b) => b.querySelector('.when')?.textContent ?? '');
	}

	it('shows the next interval on each grade button once the card is done', async () => {
		configure(['vocab']);
		render(Page);
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
		expect(screen.queryByRole('group', { name: 'Grade this card' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		await screen.findByRole('group', { name: 'Grade this card' });
		expect(shown()).toEqual(NEW_CARD.map((e) => shortInterval(e.ms)));
		expect(shown().slice(0, 3)).toEqual(['<1m', '6m', '10m']);
	});

	it('the label equals the schedule the recorded review produces', async () => {
		configure(['vocab']);
		// Record the grade the session actually writes, not an independently guessed one.
		let recorded:
			| { workspaceId: number; cardId: string; grade: number; mode: string; at: Date }
			| undefined;
		vi.mocked(recordReview).mockImplementationOnce(async (workspaceId, cardId, grade, mode) => {
			recorded = { workspaceId, cardId, grade, mode, at: new Date() };
		});
		render(Page);
		await screen.findByLabelText('Recognise card');
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		const good = await screen.findByRole('button', { name: /^Good, next review/ });
		await fireEvent.click(good);
		await waitFor(() => expect(recorded).toBeDefined());
		const r = recorded!;
		const due = scheduleFor(
			r.cardId,
			[
				{
					id: '01JTESTREVIEW0000000000009',
					workspaceId: r.workspaceId,
					device: 'web',
					ts: r.at.toISOString(),
					type: 'review',
					payload: { cardId: r.cardId, mode: r.mode as never, grade: r.grade as never }
				}
			],
			r.at,
			DEFAULT_W,
			IDENTITY_CLOCK
		)!.due;
		expect(shortInterval(Date.parse(due) - r.at.getTime())).toBe(good.querySelector('.when')!.textContent);
	});

	it('announces "Good. Next review in 10 minutes." in a polite status after a grade', async () => {
		configure(['vocab']);
		render(Page);
		await screen.findByLabelText('Recognise card');
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		await fireEvent.click(await screen.findByRole('button', { name: /^Good, next review/ }));
		const live = await waitFor(() => {
			const el = document.querySelector('.graded[role="status"]');
			expect(el?.textContent).toBe('Good. Next review in 10 minutes.');
			return el!;
		});
		expect(live.getAttribute('aria-live')).toBe('polite');
	});

	it('a re-show says practice and announces practice only', async () => {
		configure(['vocab'], 1);
		render(Page);
		await screen.findByLabelText('Recognise card');
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		await fireEvent.click(await screen.findByRole('button', { name: /^Again, next review/ }));
		await waitFor(() => expect(screen.getByText(/Again, look 2 of/)).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		await screen.findByRole('group', { name: 'Grade this card' });
		expect(shown()).toEqual(Array(4).fill('practice'));
		await fireEvent.click(screen.getByRole('button', { name: /^Good, practice only/ }));
		await waitFor(() =>
			expect(document.querySelector('.graded[role="status"]')?.textContent).toBe('Good. Practice only, not counted.')
		);
		expect(recordReview).toHaveBeenCalledTimes(1);
	});

	it("moves focus to the next card's heading after a grade", async () => {
		configure(['vocab']);
		render(Page);
		await screen.findByLabelText('Recognise card');
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		await fireEvent.click(await screen.findByRole('button', { name: /^Good, next review/ }));
		await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Recognise card, 2 of 3'));
		expect(document.activeElement?.tagName).toBe('H1');
	});

	it('Space reveals and 1–4 grade (unchanged)', async () => {
		configure(['vocab']);
		render(Page);
		await screen.findByLabelText('Recognise card');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
		await screen.findByRole('group', { name: 'Grade this card' });
		window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }));
		await waitFor(() => expect(recordReview).toHaveBeenCalledWith(1, 'c-vocab-11', 3, 'vocab', expect.anything()));
	});

	it('the kind label reads Recognise and the deck · level shows the level', async () => {
		// A level item has no deck yet: the level alone.
		configure(['vocab']);
		render(Page);
		await screen.findByLabelText('Recognise card');
		const head = document.querySelector('.face-head')!;
		expect(head.querySelector('.kind')?.textContent).toBe('Recognise');
		expect(head.querySelector('.deck')?.textContent).toBe('JLPT kanji N5');
	});
});

describe('deck · level in a deck session (#101)', () => {
	it('names the card\'s first deck and its level badge', async () => {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({ mode: 'decks', schemeId: null, levelName: null, deckIds: ['d1'], newLimit: 20, reviewLimit: 100, cardTypes: ['vocab'] })
		);
		vi.mocked(getEntry).mockImplementation(async (id: number) => ({
			...kanji(id, GLYPHS[id] ?? '?'),
			badges: [{ schemeId: 3, schemeName: 'JLPT kanji', levelName: 'N5', derived: false }]
		}));
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [{ id: 'd1', name: 'Kanji', createdAt: '2026-01-01T00:00:00.000Z' }],
			cards: [{ id: 'v11', kind: 'vocab', entryId: 11, written: '日', deckIds: ['d1'], createdAt: '2026-01-01T00:00:00.000Z' }],
			reviews: [],
			merged: 0
		} as never);
		render(Page);
		await screen.findByLabelText('Recognise card');
		await waitFor(() => expect(document.querySelector('.face-head .deck')?.textContent).toBe('Kanji · JLPT kanji N5'));
	});
});

describe('kana display forms on the faces (#101, prep-run item 1)', () => {
	const no = {
		id: 41,
		language: 'ja',
		kind: 'word',
		written: '乃',
		readings: [{ type: 'kana', value: 'の', plain: 'no', ord: 0 }],
		badges: [],
		variants: [],
		sentences: [],
		senses: [{ dictionaryId: 1, dictionaryName: 'JMdict', packId: 'j', license: 'x', attribution: 'x', gloss: "possessive particle" }]
	} as unknown as Entry;
	const card = (kind: string): StudyCard =>
		({ id: `k-${kind}`, kind, entryId: 41, written: 'の', deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' }) as StudyCard;

	function decks(kind: string): void {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({ mode: 'decks', schemeId: null, levelName: null, deckIds: ['general'], newLimit: 20, reviewLimit: 100, cardTypes: [kind] })
		);
		vi.mocked(getEntry).mockResolvedValue(no);
		vi.mocked(loadStudyData).mockResolvedValue({
			decks: [],
			cards: [card(kind)],
			reviews: [],
			merged: 0,
		} as never);
	}

	// Recall draws from the same resolved entry (resolveItem applies withShownWritten to every kind);
	// its face is checked with the real card in ReverseCard.dom.test.ts.
	it('Recognise shows の, not 乃, in the prompt and the answer', async () => {
		decks('vocab');
		render(Page);
		await screen.findByLabelText('Recognise card');
		expect(document.querySelector('.face-prompt')?.textContent).toContain('の');
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		await screen.findByRole('group', { name: 'Grade this card' });
		expect(document.querySelector('.fc')?.textContent).not.toContain('乃');
	});

});

describe('the session loads once (#101, found in the real-app check)', () => {
	it('a change of the offline state (a flushed outbox, a cached answer) does not reload the session', async () => {
		configure(['vocab']);
		render(Page);
		await screen.findByLabelText('Recognise card');
		expect(loadStudyData).toHaveBeenCalledTimes(1);
		offline.update((s) => ({ ...s, allSentAt: Date.now() }));
		offline.update((s) => ({ ...s, queued: 3 }));
		await new Promise((r) => setTimeout(r, 0));
		expect(loadStudyData).toHaveBeenCalledTimes(1);
		expect(screen.getByLabelText('Recognise card')).toBeTruthy();
		resetOffline();
	});
});
