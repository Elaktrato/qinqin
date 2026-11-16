import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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

import { getBook, getChapter } from '$lib/api/library';
import { segmentWithReadings } from '$lib/api/segment';
import { setSettings } from '$lib/workspaces';
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
});
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
		await fireEvent.click(screen.getByRole('button', { name: 'Display' }));
		await fireEvent.click(screen.getByRole('radio', { name: /^Never/ }));
		await waitFor(() => expect(document.querySelectorAll('ruby.gen')).toHaveLength(0));
		await waitFor(() => expect(setSettings).toHaveBeenCalledTimes(1), { timeout: 2000 });
		expect(setSettings).toHaveBeenCalledWith(7, { reader: { version: 1, readings: 'never', smartThreshold: 80 } });
		await tick();
		expect(segmentWithReadings).toHaveBeenCalledTimes(1);
	});
});
