import { StudyDays } from '$lib/time/studyDays';
import type { MockInstance } from 'vitest';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
/** One rule object, as the session's StudyDays caches it. */
const SHARED_DAY = studyDayOf([]);
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Scheme } from '$lib/api/types';
import type { ReviewEvent, StudyCard } from '$lib/study/types';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/entries', () => ({ getEntry: vi.fn() }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn() }));
vi.mock('$lib/api/audio', () => ({ resolveAudio: vi.fn(async () => ({})) }));
// The session's outbox, faked (record 0009: the page records through useSession().outbox).
const outboxFakes = vi.hoisted(() => ({
	flush: vi.fn(async () => {}),
	recordReview: vi.fn<import('$lib/study/events').ReviewOutbox['recordReview']>(async () => null),
	recordReplacement: vi.fn<import('$lib/study/events').ReviewOutbox['recordReplacement']>(async () => null)
}));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	loadStudyData: vi.fn()
}));
vi.mock('$lib/study/commands/cards', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/commands/cards')>()),
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
vi.mock('$lib/study/sessionMix', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/study/sessionMix')>();
	return { ...real, mixFlowQueue: vi.fn(real.mixFlowQueue) };
});

import { getEntry } from '$lib/api/entries';
import { loadNoteCfg, loadNotes } from '$lib/notes/store';
import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
const { recordReplacement, recordReview } = outboxFakes;
import { SESSION_CONFIG_KEY } from '$lib/study/session';
import { mixFlowQueue } from '$lib/study/sessionMix';
import { addCard } from '$lib/study/commands/cards';
import { loadStudyData } from '$lib/study/data';
import { usableChars } from '$lib/study/writing';
import { studyDay } from '$lib/time/studyDay';
import Page from './+page.svelte';
import { goto } from '$app/navigation';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_W } from '$lib/study/fsrs/params';
import { shortInterval } from '$lib/study/intervalText';
import { scheduleFor } from '$lib/study/scheduler';
import { IDENTITY_CLOCK } from '$lib/study/studyClock';
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
	Object.assign(ctx.session.outbox, outboxFakes);
});

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
			cardTypes,
			// These tests follow the level's own order; random is the default.
			newOrder: 'deck'
		})
	);
}

function history(cards: StudyCard[], reviews: ReviewEvent[]): void {
	vi.mocked(loadStudyData).mockResolvedValue(build.history({ cards, reviews }));
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
	vi.mocked(addCard).mockImplementation(async (_study, _ws, entryId, opts) => ({
		id: `c-${opts?.kind ?? 'vocab'}-${entryId}`,
		kind: opts?.kind ?? 'vocab',
		entryId,
		deckIds: ['general'],
		createdAt: new Date().toISOString()
	}));
	history([], []);
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

describe('character level session', () => {
	it('shows the glyph first, readings after the reveal, and grades into one card', async () => {
		configure(['vocab']);
		render(Page, { context: ctx.context });
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
		expect(screen.getByText('日')).toBeTruthy();
		expect(screen.queryByLabelText('Readings')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		expect(screen.getByLabelText('Readings')).toBeTruthy();
		expect(screen.getByText('sun')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: /Good/ }));
		await waitFor(() => expect(recordReview).toHaveBeenCalledTimes(1));
		expect(addCard).toHaveBeenCalledWith(expect.anything(), 
			1,
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
		render(Page, { context: ctx.context });
		expect(await screen.findByLabelText('Write card')).toBeTruthy();
	});

	it('skips a writing item without stroke data and shows the next reserve item', async () => {
		configure(['writing'], 1);
		vi.mocked(usableChars).mockImplementation(async (written: string) =>
			written === '日' ? [] : [...written]
		);
		render(Page, { context: ctx.context });
		expect(await screen.findByLabelText('Write card')).toBeTruthy();
		await waitFor(() => expect(getEntry).toHaveBeenCalledWith(12));
		expect(addCard).not.toHaveBeenCalled();
	});

	it('runs a writing-only session', async () => {
		configure(['writing']);
		render(Page, { context: ctx.context });
		expect(await screen.findByLabelText('Write card')).toBeTruthy();
	});

	it('drops a character without glosses from a writing session and remembers it', async () => {
		configure(['writing'], 1);
		vi.mocked(getEntry).mockImplementation(async (id: number) => ({
			...kanji(id, GLYPHS[id] ?? '?'),
			senses: id === 11 ? [] : kanji(id, '?').senses
		}));
		render(Page, { context: ctx.context });
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


	it('says the workspace is not ready when nothing was saved', async () => {
		ctx.app.offline.reportNetworkFailure();
		configureDecks(['vocab']);
		vi.mocked(loadStudyData).mockRejectedValue(new TypeError('Failed to fetch'));
		render(Page, { context: ctx.context });
		expect(await screen.findByText("This workspace isn't ready for offline study yet. Open it once while online.")).toBeTruthy();
	});

	it('a level session offline says it needs a connection', async () => {
		ctx.app.offline.reportNetworkFailure();
		configure(['vocab']);
		vi.mocked(getSchemes).mockRejectedValue(new TypeError('Failed to fetch'));
		render(Page, { context: ctx.context });
		expect(await screen.findByText('Level sessions need a connection. Start a deck session instead.')).toBeTruthy();
	});

	it('studies saved real cards and notes that companion cards return online', async () => {
		ctx.app.offline.reportNetworkFailure();
		configureDecks(['vocab', 'sentence']);
		history([word(11), word(12)], []);
		render(Page, { context: ctx.context });
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
		ctx.session.workspaces.set({
			list: [{ id: 2, language: 'zh', name: 'zh' } as never],
			current: { id: 2, language: 'zh', name: 'zh' } as never
		});
		vi.mocked(getEntry).mockResolvedValue(word);
		vi.mocked(usableChars).mockResolvedValue(['日', '本']);
		vi.mocked(loadNotes).mockResolvedValue(new Map([[21, NOTE]]));
		vi.mocked(loadNoteCfg).mockResolvedValue({ onAnswer: true, extra: {} });
	});

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
			render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
	});

	it('an offline session makes no notes request', async () => {
		ctx.app.offline.reportNetworkFailure();
		configureDecks(['vocab']);
		history([cardOf('vocab')], []);
		render(Page, { context: ctx.context });
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
		ctx.session.workspaces.set({ list: [], current: null });
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
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
			| { workspaceId: number; cardId: string; grade: number; mode: string | undefined; at: Date }
			| undefined;
		vi.mocked(recordReview).mockImplementationOnce(async (workspaceId, cardId, grade, mode) => {
			recorded = { workspaceId, cardId, grade, mode, at: new Date() };
			return null;
		});
		render(Page, { context: ctx.context });
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
					payload: { cardId: r.cardId, mode: (r.mode ?? 'vocab') as never, grade: r.grade as never }
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
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
		await screen.findByLabelText('Recognise card');
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		await fireEvent.click(await screen.findByRole('button', { name: /^Good, next review/ }));
		await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Recognise card, 2 of 3'));
		expect(document.activeElement?.tagName).toBe('H1');
	});

	it('Space reveals and 1–4 grade (unchanged)', async () => {
		configure(['vocab']);
		render(Page, { context: ctx.context });
		await screen.findByLabelText('Recognise card');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
		await screen.findByRole('group', { name: 'Grade this card' });
		window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }));
		await waitFor(() => expect(recordReview).toHaveBeenCalledWith(1, 'c-vocab-11', 3, 'vocab', expect.anything()));
	});

	it('the kind label reads Recognise and the deck · level shows the level', async () => {
		// A level item has no deck yet: the level alone.
		configure(['vocab']);
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
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
		render(Page, { context: ctx.context });
		await screen.findByLabelText('Recognise card');
		expect(loadStudyData).toHaveBeenCalledTimes(1);
		ctx.app.offline.allSentAt = Date.now();
		ctx.app.offline.setQueued(3);
		await new Promise((r) => setTimeout(r, 0));
		expect(loadStudyData).toHaveBeenCalledTimes(1);
		expect(screen.getByLabelText('Recognise card')).toBeTruthy();
	});
});

describe('order of card types (#132)', () => {
	const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString();
	const card = (kind: 'vocab' | 'writing', entryId: number, minutes: number): StudyCard => ({
		id: `c-${kind}-${entryId}`,
		kind,
		entryId,
		written: GLYPHS[entryId],
		deckIds: ['general'],
		createdAt: at(minutes)
	});
	// In the order added the two writing cards come first.
	const cards = [card('writing', 11, 1), card('writing', 12, 2), card('vocab', 11, 3), card('vocab', 12, 4)];
	const plan = cards.map((c) => ({ cardId: c.id, kind: c.kind, entryId: c.entryId, virtual: false, card: c }));

	function start(extra: Record<string, unknown>): void {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({
				mode: 'decks',
				schemeId: null,
				levelName: null,
				deckIds: ['general'],
				newLimit: 20,
				reviewLimit: 100,
				cardTypes: ['vocab', 'writing'],
				newOrder: { by: 'added' },
				...extra
			})
		);
		history(cards, []);
	}

	it('grouped by type shows the vocab cards first', async () => {
		start({ typeOrder: 'grouped', seed: 1 });
		render(Page, { context: ctx.context });
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
	});

	it('mixed follows the session seed, Recognise first for a new word', async () => {
		const { mixFlowQueue: real } = await vi.importActual<typeof import('$lib/study/sessionMix')>('$lib/study/sessionMix');
		const first = (seed: number) => real(plan, [], { seed, order: 'mixed', vocabFirst: true })[0];
		const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
		// A new word's writing card waits for its vocab card: the first card is always a vocab card.
		expect(seeds.every((seed) => first(seed).kind === 'vocab')).toBe(true);
		const sunSeed = seeds.find((seed) => first(seed).entryId === 11)!;
		const moonSeed = seeds.find((seed) => first(seed).entryId === 12)!;
		expect(sunSeed).toBeDefined();
		expect(moonSeed).toBeDefined();

		start({ seed: sunSeed });
		render(Page, { context: ctx.context });
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
		expect(await screen.findByText('日')).toBeTruthy();
		expect(vi.mocked(mixFlowQueue).mock.calls[0][2]).toEqual({ seed: sunSeed, order: 'mixed', vocabFirst: true });
		cleanup();

		start({ seed: moonSeed });
		render(Page, { context: ctx.context });
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
		expect(await screen.findByText('月')).toBeTruthy();
	});
});

describe('the mix on the page (#132 review)', () => {
	const ids = (call: unknown[]) => (call[0] as { cardId: string }[]).map((item) => item.cardId);

	it('a level session shows the mixed order', async () => {
		configure(['vocab']);
		// Reverse the queue: the page must show what the mix returns.
		vi.mocked(mixFlowQueue).mockImplementationOnce((queue) => [...queue].reverse());
		render(Page, { context: ctx.context });
		expect(await screen.findByLabelText('Recognise card')).toBeTruthy();
		const call = vi.mocked(mixFlowQueue).mock.calls[0];
		expect(ids(call)).toEqual(['level:11', 'level:12', 'level:13']);
		await waitFor(() => expect(screen.getByText('火')).toBeTruthy());
	});

	it('the same setup gives the same seed and queue on a reload', async () => {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({ mode: 'levels', schemeId: 3, levelName: 'N5', deckIds: ['general'], newLimit: 20, reviewLimit: 100, cardTypes: ['vocab'], seed: 4321 })
		);
		render(Page, { context: ctx.context });
		await screen.findByLabelText('Recognise card');
		cleanup();
		render(Page, { context: ctx.context });
		await screen.findByLabelText('Recognise card');
		const calls = vi.mocked(mixFlowQueue).mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][2]).toEqual({ seed: 4321, order: 'mixed', vocabFirst: false });
		expect(calls[1][2]).toEqual(calls[0][2]);
		expect(vi.mocked(mixFlowQueue).mock.results.map((r) => (r.value as { cardId: string }[]).map((i) => i.cardId))).toEqual([
			expect.any(Array),
			(vi.mocked(mixFlowQueue).mock.results[0].value as { cardId: string }[]).map((i) => i.cardId)
		]);
	});

	it('a setup without a seed keeps one seed across reloads', async () => {
		configure(['vocab']);
		render(Page, { context: ctx.context });
		await screen.findByLabelText('Recognise card');
		cleanup();
		render(Page, { context: ctx.context });
		await screen.findByLabelText('Recognise card');
		const calls = vi.mocked(mixFlowQueue).mock.calls;
		expect(calls).toHaveLength(2);
		expect(Number.isInteger((calls[0][2] as { seed: number }).seed)).toBe(true);
		expect(calls[1][2]).toEqual(calls[0][2]);
	});
});

describe('Back: change a misclicked grade (#131)', () => {
	function configureDecks(): void {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({ mode: 'decks', schemeId: null, levelName: null, deckIds: ['general'], newLimit: 20, reviewLimit: 100, cardTypes: ['vocab'], newOrder: 'deck', typeOrder: 'grouped' })
		);
	}
	const word = (id: number): StudyCard => ({ id: `v${id}`, kind: 'vocab', entryId: id, written: GLYPHS[id], deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' });
	let seq = 0;
	const recorded: ReviewEvent[] = [];

	beforeEach(() => {
		seq = 0;
		recorded.length = 0;
		vi.mocked(recordReview).mockImplementation(async (workspaceId, cardId, grade, mode = 'vocab', meta) => {
			const event: ReviewEvent = {
				id: `01KAPZ0000000000000000000${++seq}`,
				workspaceId,
				device: 'web',
				ts: '2026-11-22T09:00:00.000Z',
				type: 'review',
				payload: { cardId, mode, grade, ...(meta ? { meta } : {}) }
			};
			recorded.push(event);
			return event;
		});
		vi.mocked(recordReplacement).mockImplementation(async (target, grade) => ({
			...target,
			id: `01KAPZ000000000000000000R${++seq}`,
			payload: { ...target.payload, grade, replaces: target.id }
		}));
	});

	async function gradeShown(name: RegExp): Promise<void> {
		await fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
		await fireEvent.click(screen.getByRole('button', { name }));
	}

	function gradeButton(name: string): HTMLElement {
		return screen.getAllByRole('button').find((b) => b.querySelector('.name')?.textContent === name)!;
	}

	it('goes back to the card graded Again and changes it to Good: one replacement, no re-show', async () => {
		configureDecks();
		history([word(11), word(12), word(13)], []);
		render(Page, { context: ctx.context });
		expect(await screen.findByText('日')).toBeTruthy();
		await gradeShown(/^Again/);
		expect(await screen.findByText('月')).toBeTruthy();
		expect(screen.getByText('2 / 3, 1 to repeat')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: /^Back to the card graded before/ }));
		expect(await screen.findByText('日')).toBeTruthy();
		// The answer side as it was left, the previous grade marked.
		expect(screen.getByLabelText('Readings')).toBeTruthy();
		expect(screen.getByText('Graded Again')).toBeTruthy();
		expect(gradeButton('Again').getAttribute('aria-pressed')).toBe('true');
		expect(gradeButton('Good').getAttribute('aria-pressed')).toBe('false');

		await fireEvent.click(gradeButton('Good'));
		await waitFor(() => expect(recordReplacement).toHaveBeenCalledWith(recorded[0], 3));
		expect(recordReview).toHaveBeenCalledTimes(1);
		// Back on the current card; the Again's re-show is gone.
		expect(await screen.findByText('月')).toBeTruthy();
		expect(screen.getByText('2 / 3')).toBeTruthy();
		expect(screen.queryByText('Graded Again')).toBeNull();
	});

	it('choosing the same grade records nothing', async () => {
		configureDecks();
		history([word(11), word(12)], []);
		render(Page, { context: ctx.context });
		await gradeShown(/^Good/);
		expect(await screen.findByText('月')).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'z' });
		expect(await screen.findByText('Graded Good')).toBeTruthy();
		await fireEvent.keyDown(window, { key: '3' });
		await waitFor(() => expect(screen.queryByText('Graded Good')).toBeNull());
		expect(recordReplacement).not.toHaveBeenCalled();
		expect(screen.getByText('月')).toBeTruthy();
	});

	it('Z goes further back, Escape returns without a change', async () => {
		configureDecks();
		history([word(11), word(12), word(13)], []);
		render(Page, { context: ctx.context });
		await gradeShown(/^Good/);
		expect(await screen.findByText('月')).toBeTruthy();
		await gradeShown(/^Hard/);
		expect(await screen.findByText('火')).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'z' });
		expect(await screen.findByText('Graded Hard')).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'Z' });
		expect(await screen.findByText('Graded Good')).toBeTruthy();
		expect(screen.getByText('日')).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(await screen.findByText('火')).toBeTruthy();
		expect(screen.queryByText(/^Graded/)).toBeNull();
		expect(recordReplacement).not.toHaveBeenCalled();
	});

	it('from the summary: the last card changed to Again comes back as a re-show', async () => {
		configureDecks();
		history([word(11)], []);
		render(Page, { context: ctx.context });
		await gradeShown(/^Good/);
		expect(await screen.findByText('Session complete')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Change the last grade' }));
		expect(await screen.findByText('Graded Good')).toBeTruthy();
		await fireEvent.click(gradeButton('Again'));
		await waitFor(() => expect(recordReplacement).toHaveBeenCalledWith(recorded[0], 1));
		expect(await screen.findByText('Again, look 2 of 4')).toBeTruthy();
		expect(screen.queryByText('Session complete')).toBeNull();
	});

	it('Z typed into a field or a card input never goes back (review fix 3)', async () => {
		configureDecks();
		history([word(11), word(12)], []);
		render(Page, { context: ctx.context });
		await gradeShown(/^Good/);
		expect(await screen.findByText('月')).toBeTruthy();
		const field = document.createElement('input');
		const pad = document.createElement('div');
		pad.setAttribute('data-card-input', '');
		pad.tabIndex = 0;
		document.body.append(field, pad);
		try {
			for (const target of [field, pad]) {
				target.focus();
				await fireEvent.keyDown(target, { key: 'z' });
				await new Promise((r) => setTimeout(r, 0));
				expect(screen.queryByText(/^Graded/)).toBeNull();
			}
			// The same key outside them does go back.
			field.blur();
			await fireEvent.keyDown(window, { key: 'z' });
			expect(await screen.findByText('Graded Good')).toBeTruthy();
		} finally {
			field.remove();
			pad.remove();
		}
	});

	it('the summary counts the changed grade: XP and reviews (review fix 4)', async () => {
		configureDecks();
		history([word(11), word(12)], []);
		render(Page, { context: ctx.context });
		await gradeShown(/^Good/);
		expect(await screen.findByText('月')).toBeTruthy();
		await gradeShown(/^Good/);
		expect(await screen.findByText('Session complete')).toBeTruthy();
		// Two Good vocab reviews: 2 x (10 + 5) + the daily bonus 10.
		expect(screen.getByText('+40')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Change the last grade' }));
		await fireEvent.click(gradeButton('Easy'));
		await waitFor(() => expect(recordReplacement).toHaveBeenCalledWith(recorded[1], 4));
		expect(await screen.findByText('Session complete')).toBeTruthy();
		// Easy replaces Good: + 5 more, still two reviews.
		expect(screen.getByText('+45')).toBeTruthy();
		expect(screen.getByText('+35')).toBeTruthy();
		expect(screen.getByText('2')).toBeTruthy();
	});

	it('a grade whose review was not kept is changed in the session only (review fix 8)', async () => {
		vi.mocked(recordReview).mockResolvedValueOnce(null);
		configureDecks();
		history([word(11), word(12), word(13)], []);
		render(Page, { context: ctx.context });
		await gradeShown(/^Again/);
		expect(await screen.findByText('2 / 3, 1 to repeat')).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'z' });
		expect(await screen.findByText('Graded Again')).toBeTruthy();
		await fireEvent.click(gradeButton('Good'));
		expect(await screen.findByText('2 / 3')).toBeTruthy();
		expect(recordReplacement).not.toHaveBeenCalled();
	});

	it('no Back before the first grade', async () => {
		configureDecks();
		history([word(11)], []);
		render(Page, { context: ctx.context });
		expect(await screen.findByText('日')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Back to the card graded before/ })).toBeNull();
		await fireEvent.keyDown(window, { key: 'z' });
		expect(screen.queryByText(/^Graded/)).toBeNull();
	});
});

describe('leaving the session (the study modal)', () => {
	function configureFrom(from: string): void {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({ mode: 'decks', schemeId: null, levelName: null, deckIds: ['general'], newLimit: 20, reviewLimit: 100, cardTypes: ['vocab'], from })
		);
	}
	const word = (id: number): StudyCard => build.card({ id: `v${id}`, kind: 'vocab', entryId: id, written: '日', deckIds: ['general'] });
	async function gradeShown(name: RegExp): Promise<void> {
		await fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
		await fireEvent.click(screen.getByRole('button', { name }));
	}

	it('without a running session it opens the study modal in place of the old address', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/study', { replaceState: true }));
	});

	it('an empty session goes back where it was started and opens the modal', async () => {
		configureFrom('/flashcards');
		render(Page, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('link', { name: 'Back to study' }));
		expect(goto).toHaveBeenCalledWith('/flashcards');
		await waitFor(() => expect(ctx.session.studyModal.open).toBe(true));
	});

	it('a finished session goes back with the modal closed', async () => {
		configureFrom('/flashcards/deck/d1');
		history([word(11)], []);
		render(Page, { context: ctx.context });
		await gradeShown(/^Good/);
		expect(await screen.findByText('Session complete')).toBeTruthy();
		await fireEvent.click(screen.getByRole('link', { name: 'Done' }));
		expect(goto).toHaveBeenCalledWith('/flashcards/deck/d1');
		await Promise.resolve();
		expect(ctx.session.studyModal.open).toBe(false);
	});

	it('End session goes back where it was started and opens the modal', async () => {
		configureFrom('/');
		history([word(11), word(12)], []);
		render(Page, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('link', { name: 'End session' }));
		expect(goto).toHaveBeenCalledWith('/');
		await waitFor(() => expect(ctx.session.studyModal.open).toBe(true));
	});
});
