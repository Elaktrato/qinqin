import { pagedPull } from '$lib/study/testing/legacyCodec';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/events', () => ({ record: vi.fn(), loadWorkspaceEvents: vi.fn(), onEventLogChange: vi.fn(() => () => {}) }));
vi.mock('$lib/api/library', () => ({
	getBook: vi.fn(),
	getChapter: vi.fn(),
	listBookmarks: vi.fn(async () => []),
	listHighlights: vi.fn(async () => []),
	setPosition: vi.fn(async () => {}),
	addBookmark: vi.fn(),
	renameBookmark: vi.fn(),
	deleteBookmark: vi.fn(),
	addHighlight: vi.fn(),
	updateHighlight: vi.fn(),
	deleteHighlight: vi.fn()
}));
vi.mock('$lib/api/segment', () => ({ segmentWithReadings: vi.fn(), segmentAt: vi.fn(async () => null), segmentBatch: vi.fn() }));
vi.mock('$lib/study/history', () => ({
	loadStudyHistory: vi.fn(async () => ({
		decks: [],
		cards: [{ id: 'c1', kind: 'vocab', entryId: 1, deckIds: ['general'] }],
		reviews: [],
		merged: 0
	})),
	invalidateStudyHistory: vi.fn()
}));
vi.mock('$lib/api/entryBases', () => ({
	loadEntryBases: vi.fn(async (ids: number[]) => new Map(ids.map((id) => [id, { id, language: 'zh', kind: 'word', written: `w${id}`, readings: [], attrs: {}, radicalId: null }])))
}));
vi.mock('$lib/study/currentContext', () => ({ contextForData: () => ({ clock: {} }) }));
vi.mock('../flashcards/decks/deckStats', () => ({
	scheduleIndex: vi.fn(() => new Map([['c1', { due: '', stability: 200, difficulty: 5, state: 2 }]]))
}));
vi.mock('$lib/workspaces', async () => {
	const { writable } = await import('svelte/store');
	const state = writable({
		list: [{ id: 7, language: 'zh', name: '', settings: { reader: { readings: 'smart', smartThreshold: 80 } }, updatedAt: '' }],
		current: null as unknown
	});
	return { workspaces: state, setSettings: vi.fn(async () => ({})) };
});

import { getBook, getChapter, listBookmarks, listHighlights } from '$lib/api/library';
import { loadStudyHistory } from '$lib/study/history';
import { segmentWithReadings } from '$lib/api/segment';
import { setSettings, workspaces } from '$lib/workspaces';
import BookView from './BookView.svelte';

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	vi.stubGlobal('IntersectionObserver', FakeObserver);
	vi.stubGlobal('ResizeObserver', FakeObserver);
	vi.mocked(getBook).mockResolvedValue({
		id: 1, workspaceId: 7, language: 'zh', title: 'T', author: '', source: '', sourceId: '', sourceUrl: '',
		attribution: '', licenseNote: '', chapterCount: 1, position: '', createdAt: ''
	});
	vi.mocked(getChapter).mockResolvedValue({ title: 'One', paragraphs: [[{ text: '你好世界' }]] });
	vi.mocked(segmentWithReadings).mockReset();
	vi.mocked(segmentWithReadings).mockResolvedValue([
		{ surface: '你好', start: 0, end: 2, lemma: '你好', reason: '', entries: [{ id: 1, kind: 'word' }], reading: { type: 'pinyin', value: 'nǐ hǎo' } },
		{ surface: '世界', start: 2, end: 4, lemma: '世界', reason: '', entries: [{ id: 2, kind: 'word' }], reading: { type: 'pinyin', value: 'shì jiè' } }
	]);
	vi.mocked(setSettings).mockClear();
	setReader({ readings: 'smart', smartThreshold: 80 });
});

function setReader(reader: Record<string, unknown>): void {
	workspaces.set({
		list: [{ id: 7, language: 'zh', name: '', settings: { reader }, updatedAt: '' }],
		current: null
	} as never);
}
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('BookView readings', () => {
	it('smart: loads readings once, conceals the mastered word, shows the other', async () => {
		render(BookView, { id: 1, chapter: 0 });
		await waitFor(() => expect(document.querySelectorAll('ruby.gen rt')).toHaveLength(2));
		const rts = Array.from(document.querySelectorAll('ruby.gen rt'));
		expect(rts.map((r) => [r.textContent, r.classList.contains('concealed')])).toEqual([
			['nǐ hǎo', true],
			['shì jiè', false]
		]);
		expect(segmentWithReadings).toHaveBeenCalledTimes(1);
		expect(vi.mocked(segmentWithReadings).mock.calls[0][0]).toBe('zh');
	});

	it('Show all readings (and the R key) reveal everything', async () => {
		render(BookView, { id: 1, chapter: 0 });
		await waitFor(() => expect(document.querySelectorAll('ruby.gen')).toHaveLength(2));
		const root = document.querySelector('.chapter-text')!;
		expect(root.classList.contains('show-all')).toBe(false);
		await fireEvent.keyDown(window, { key: 'r' });
		expect(root.classList.contains('show-all')).toBe(true);
		await fireEvent.keyDown(window, { key: 'r' });
		expect(root.classList.contains('show-all')).toBe(false);
	});

	it('switching to Never makes the readings go and saves one patch', async () => {
		render(BookView, { id: 1, chapter: 0 });
		await waitFor(() => expect(document.querySelectorAll('ruby.gen')).toHaveLength(2));
		// The Display settings are the rail's Display tab now (#102).
		await fireEvent.click(screen.getByRole('tab', { name: 'Display' }));
		await fireEvent.click(screen.getByRole('radio', { name: /^Never/ }));
		await waitFor(() => expect(document.querySelectorAll('ruby.gen')).toHaveLength(0));
		await waitFor(() => expect(setSettings).toHaveBeenCalledTimes(1), { timeout: 2000 });
		expect(setSettings).toHaveBeenCalledWith(7, { reader: { version: 1, readings: 'never', smartThreshold: 80 } });
		await tick();
		expect(segmentWithReadings).toHaveBeenCalledTimes(1);
	});
});

describe('BookView word states', () => {
	it('highlighting off and readings never: no segment request at all', async () => {
		setReader({ readings: 'never', highlightWords: false });
		render(BookView, { id: 1, chapter: 0 });
		await screen.findByText('你好世界');
		await tick();
		await new Promise((r) => setTimeout(r, 50));
		expect(segmentWithReadings).not.toHaveBeenCalled();
		expect(document.querySelector('.w-new, .w-learning')).toBeNull();
	});

	it('highlighting on with readings never: loads matches and marks the new word only', async () => {
		setReader({ readings: 'never', highlightWords: true });
		render(BookView, { id: 1, chapter: 0 });
		// In the text (the Display legend draws a sample mark too).
		await waitFor(() => expect(document.querySelectorAll('.chapter-text .w-new')).toHaveLength(1));
		expect(document.querySelector('.chapter-text .w-new')?.textContent).toBe('世界');
		expect(document.querySelector('ruby.gen')).toBeNull();
		expect(segmentWithReadings).toHaveBeenCalledTimes(1);
	});
});

describe('BookView Words tab', () => {
	it('opening the Words tab loads the matches and shows the chapter figure', async () => {
		setReader({ readings: 'never', highlightWords: false });
		render(BookView, { id: 1, chapter: 0 });
		await screen.findByText('你好世界');
		expect(segmentWithReadings).not.toHaveBeenCalled();
		await fireEvent.click(await screen.findByRole('tab', { name: /Words/ }));
		// 你好 is known (score 90), 世界 is new: 1 of 2 tokens.
		await screen.findByText('You know 50% of the words in this chapter');
		expect(segmentWithReadings).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('checkbox', { name: '世界' })).toBeTruthy();
		// The panel alone draws no word states in the text.
		expect(document.querySelector('.w-new')).toBeNull();
	});
});

describe('BookView Words tab across books', () => {
	it('a selection does not survive opening another book in the same page', async () => {
		setReader({ readings: 'never', highlightWords: false });
		const r = render(BookView, { id: 1, chapter: 0 });
		await fireEvent.click(await screen.findByRole('tab', { name: /Words/ }));
		const box = (await screen.findByRole('checkbox', { name: '世界' })) as HTMLInputElement;
		await fireEvent.click(box);
		expect(screen.getByRole('button', { name: 'Add selected (1)' })).toBeTruthy();
		vi.mocked(getBook).mockResolvedValue({
			id: 2, workspaceId: 7, language: 'zh', title: 'T2', author: '', source: '', sourceId: '', sourceUrl: '',
			attribution: '', licenseNote: '', chapterCount: 1, position: '', createdAt: ''
		});
		await r.rerender({ id: 2, chapter: 0 });
		const again = (await screen.findByRole('checkbox', { name: '世界' })) as HTMLInputElement;
		await waitFor(() => expect(getBook).toHaveBeenLastCalledWith(2));
		await tick();
		expect(again.checked).toBe(false);
		expect(screen.getByRole('button', { name: 'Add selected (0)' })).toBeTruthy();
	});

	it('nor does it survive a chapter change', async () => {
		setReader({ readings: 'never', highlightWords: false });
		vi.mocked(getBook).mockResolvedValue({
			id: 1, workspaceId: 7, language: 'zh', title: 'T', author: '', source: '', sourceId: '', sourceUrl: '',
			attribution: '', licenseNote: '', chapterCount: 2, position: '', createdAt: ''
		});
		const r = render(BookView, { id: 1, chapter: 0 });
		await fireEvent.click(await screen.findByRole('tab', { name: /Words/ }));
		await fireEvent.click(await screen.findByRole('checkbox', { name: '世界' }));
		await r.rerender({ id: 1, chapter: 1 });
		await waitFor(() => expect(getChapter).toHaveBeenLastCalledWith(1, 1));
		const again = (await screen.findByRole('checkbox', { name: '世界' })) as HTMLInputElement;
		await tick();
		expect(again.checked).toBe(false);
	});
});

describe('BookView Words tab and the known index', () => {
	it('waits for the cards before any figure or action', async () => {
		setReader({ readings: 'never', highlightWords: false });
		let release!: () => void;
		const history = vi.mocked(loadStudyHistory).getMockImplementation()!;
		vi.mocked(loadStudyHistory).mockImplementationOnce(
			(ws) => new Promise((res) => (release = () => void res(history(ws) as never)))
		);
		render(BookView, { id: 1, chapter: 0 });
		await fireEvent.click(await screen.findByRole('tab', { name: /Words/ }));
		await screen.findByText('Loading your cards…');
		expect(screen.queryByText(/You know 0%/)).toBeNull();
		expect(screen.queryByRole('button', { name: /Add all new words/ })).toBeNull();
		release();
		await screen.findByText('You know 50% of the words in this chapter');
	});

	it('a bulk add of several chunks reloads the cards once', async () => {
		setReader({ readings: 'never', highlightWords: false });
		const text = Array.from({ length: 250 }, (_, i) => String.fromCodePoint(0x4e00 + 10 + i)).join('');
		vi.mocked(getChapter).mockResolvedValue({ title: 'One', paragraphs: [[{ text }]] });
		vi.mocked(segmentWithReadings).mockResolvedValue(
			Array.from(text).map((c, i) => ({ surface: c, start: i, end: i + 1, lemma: c, reason: '', entries: [{ id: 100 + i, kind: 'word' as const }] }))
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				const body = String(url).startsWith('/api/sync/push')
					? { dataAccepted: JSON.parse(String(init?.body)).cards.length, dataSkipped: 0, dataRefused: 0 }
					: pagedPull({ pluginData: [] });
				return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
			})
		);
		render(BookView, { id: 1, chapter: 0 });
		await fireEvent.click(await screen.findByRole('tab', { name: /Words/ }));
		const all = await screen.findByRole('button', { name: 'Add all new words (250)' });
		const before = vi.mocked(loadStudyHistory).mock.calls.length;
		await fireEvent.click(all);
		await screen.findByText('Added 250 words to General');
		const pushes = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith('/api/sync/push')).length;
		expect(pushes).toBe(2);
		await waitFor(() => expect(vi.mocked(loadStudyHistory).mock.calls.length).toBe(before + 1));
		await new Promise((r) => setTimeout(r, 20));
		expect(vi.mocked(loadStudyHistory).mock.calls.length).toBe(before + 1);
	});
});

describe('BookView in another language', () => {
	it('never loads the known index for a book that is not zh or ja', async () => {
		setReader({ readings: 'smart', highlightWords: true });
		vi.mocked(loadStudyHistory).mockClear();
		vi.mocked(getBook).mockResolvedValue({
			id: 1, workspaceId: 7, language: 'en', title: 'T', author: '', source: '', sourceId: '', sourceUrl: '',
			attribution: '', licenseNote: '', chapterCount: 1, position: '', createdAt: ''
		});
		render(BookView, { id: 1, chapter: 0 });
		await screen.findByText('你好世界');
		await new Promise((r) => setTimeout(r, 30));
		expect(loadStudyHistory).not.toHaveBeenCalled();
	});
});

// #102: the rail at the right edge, the book line, the phone sheet.

// Reports every observed paragraph as in view, so "the paragraph in view" exists.
class VisibleObserver {
	constructor(private callback: (records: unknown[]) => void) {}
	observe(el: Element) {
		this.callback([{ isIntersecting: true, target: el }]);
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function setWidth(px: number): void {
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
}

const RAIL_BUTTON = 'Contents, bookmarks, highlights, words and display';

describe('BookView rail (#102)', () => {
	beforeEach(() => {
		Element.prototype.scrollIntoView ??= function () {};
	});
	afterEach(() => setWidth(1024));

	it('the rail lists Contents, Bookmarks, Highlights, Words, Display', async () => {
		setWidth(1280);
		render(BookView, { id: 1, chapter: 0 });
		const list = await screen.findByRole('tablist', { name: 'Side panel' });
		expect(within(list).getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual([
			'Contents',
			'Bookmarks',
			'Highlights',
			'Words',
			'Display'
		]);
	});

	it('the Display settings and script choice are not above the text any more', async () => {
		setWidth(1280);
		render(BookView, { id: 1, chapter: 0 });
		await screen.findByText('你好世界');
		expect(screen.queryByRole('radio', { name: /^Never/ })).toBeNull();
		expect(screen.queryByRole('combobox', { name: 'Script' })).toBeNull();
		await fireEvent.click(screen.getByRole('tab', { name: 'Display' }));
		const panel = screen.getByRole('tabpanel');
		expect(within(panel).getByRole('radio', { name: /^Never/ })).toBeTruthy();
		expect(within(panel).getByRole('combobox', { name: 'Script' })).toBeTruthy();
	});

	it('chapter navigation: Contents panel links and prev/next icon buttons at the chapter end', async () => {
		setWidth(1280);
		vi.mocked(getBook).mockResolvedValue({
			id: 1, workspaceId: 7, language: 'zh', title: 'T', author: '', source: '', sourceId: '', sourceUrl: '',
			attribution: '', licenseNote: '', chapterCount: 3, position: '', createdAt: ''
		});
		render(BookView, { id: 1, chapter: 1 });
		await screen.findByText('你好世界');
		expect(screen.queryByRole('combobox', { name: /Chapter/ })).toBeNull();
		const prev = screen.getByRole('link', { name: 'Previous chapter' });
		const next = screen.getByRole('link', { name: 'Next chapter' });
		expect(prev.getAttribute('href')).toBe('/reader/book/1/0');
		expect(next.getAttribute('href')).toBe('/reader/book/1/2');
		await fireEvent.click(screen.getByRole('tab', { name: 'Contents' }));
		const nav = screen.getByRole('navigation', { name: 'Contents' });
		expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
			'/reader/book/1/0',
			'/reader/book/1/1',
			'/reader/book/1/2'
		]);
		expect(within(nav).getByRole('link', { name: 'One (reading now)' }).getAttribute('aria-current')).toBe('page');
	});

	it('the book line shows title · author and a bookmarked state for the paragraph in view', async () => {
		setWidth(1280);
		vi.stubGlobal('IntersectionObserver', VisibleObserver);
		vi.mocked(getBook).mockResolvedValue({
			id: 1, workspaceId: 7, language: 'zh', title: '故乡', author: '鲁迅', source: '', sourceId: '', sourceUrl: '',
			attribution: '', licenseNote: '', chapterCount: 1, position: '', createdAt: ''
		});
		vi.mocked(listBookmarks).mockResolvedValueOnce([
			{ id: 5, bookId: 1, position: '0:0', label: '你好', createdAt: '2026-11-16T10:00:00Z' }
		] as never);
		render(BookView, { id: 1, chapter: 0 });
		const heading = await screen.findByRole('heading', { level: 1, name: '故乡' });
		const line = heading.closest('.book-line') as HTMLElement;
		expect(line.textContent).toContain('鲁迅');
		expect(heading.getAttribute('lang')).toBe('zh');
		expect(await within(line).findByRole('img', { name: 'This place is bookmarked' })).toBeTruthy();
	});

	it('below 1000px one button opens a sheet with the five tabs', async () => {
		setWidth(800);
		render(BookView, { id: 1, chapter: 0 });
		await screen.findByText('你好世界');
		expect(screen.queryByRole('tablist')).toBeNull();
		const buttons = screen.getAllByRole('button', { name: RAIL_BUTTON });
		expect(buttons).toHaveLength(1);
		await fireEvent.click(buttons[0]);
		const sheet = screen.getByRole('dialog', { name: 'Book tools' });
		expect(within(sheet).getAllByRole('tab').map((tab) => tab.textContent?.trim())).toEqual([
			'Contents',
			'Bookmarks',
			'Highlights',
			'Words',
			'Display'
		]);
	});

	it('jumping from a panel in the sheet closes it and moves to the place', async () => {
		setWidth(800);
		vi.mocked(listBookmarks).mockResolvedValueOnce([
			{ id: 5, bookId: 1, position: '0:0', label: '你好', createdAt: '2026-11-16T10:00:00Z' }
		] as never);
		render(BookView, { id: 1, chapter: 0 });
		await screen.findByText('你好世界');
		await fireEvent.click(screen.getByRole('button', { name: RAIL_BUTTON }));
		const sheet = screen.getByRole('dialog', { name: 'Book tools' });
		await fireEvent.click(within(sheet).getByRole('tab', { name: /Bookmarks/ }));
		await fireEvent.click(await within(sheet).findByRole('button', { name: '你好' }));
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Book tools' })).toBeNull());
		await waitFor(() => expect(document.activeElement?.getAttribute('data-p')).toBe('0'));
	});

	it('editing a highlight from the sheet closes it and opens the editor', async () => {
		setWidth(800);
		vi.mocked(listHighlights).mockResolvedValueOnce([
			{ id: 9, bookId: 1, chapter: 0, paragraph: 0, start: 0, end: 2, text: '你好', color: 'yellow', note: '', createdAt: '', updatedAt: '' }
		] as never);
		render(BookView, { id: 1, chapter: 0 });
		await waitFor(() => expect(document.querySelector('mark[data-h="9"]')).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: RAIL_BUTTON }));
		const sheet = screen.getByRole('dialog', { name: 'Book tools' });
		await fireEvent.click(within(sheet).getByRole('tab', { name: /Highlights/ }));
		await fireEvent.click(await within(sheet).findByRole('button', { name: 'Edit highlight 你好' }));
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Book tools' })).toBeNull());
		expect(await screen.findByRole('button', { name: 'Close the highlight editor' })).toBeTruthy();
	});

	it('the bookmark and highlight live regions are outside the rail and the sheet', async () => {
		setWidth(1280);
		render(BookView, { id: 1, chapter: 0 });
		const rail = await screen.findByRole('complementary', { name: 'Side panel' });
		const regions = [...document.querySelectorAll('[role="status"], [role="alert"]')].filter((el) =>
			el.classList.contains('visually-hidden')
		);
		expect(regions).toHaveLength(4);
		for (const region of regions) expect(rail.contains(region)).toBe(false);
	});

	it('existing: the Words tab is found by its name', async () => {
		render(BookView, { id: 1, chapter: 0 });
		expect(await screen.findByRole('tab', { name: /Words/ })).toBeTruthy();
	});
});
