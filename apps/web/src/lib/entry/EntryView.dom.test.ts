import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '$lib/api/types';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/entries', () => ({
	getEntry: vi.fn(),
	getCharsUnderRadical: vi.fn(async () => []),
	getSharedEntry: vi.fn()
}));
vi.mock('$lib/events', () => ({
	record: vi.fn(),
	loadWorkspaceEvents: vi.fn(async () => []),
	onEventLogChange: vi.fn(() => () => {})
}));
vi.mock('$lib/api/audio', () => ({ getEntryAudio: vi.fn(async () => ({ terms: [], syllables: null })) }));
vi.mock('$lib/api/frequency', () => ({
	getEntryRanks: vi.fn(async () => ({ pack: null, ranks: [] }))
}));
vi.mock('$lib/components/AddToStudy.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/components/StrokePlayer.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/notes/store', async (orig) => ({
	...(await orig<typeof import('$lib/notes/store')>()),
	loadNote: vi.fn(async () => null)
}));

import { getEntry } from '$lib/api/entries';
import { record } from '$lib/events';
import { workspaces } from '$lib/workspaces';
import EntryView from './EntryView.svelte';

const getEntryMock = vi.mocked(getEntry);

function entry(over: Partial<Entry> = {}): Entry {
	return {
		id: 5,
		language: 'zh',
		kind: 'word',
		written: '勤奋',
		readings: [{ type: 'pinyin', value: 'qínfèn', plain: 'qin2fen4', ord: 0 }],
		attrs: {},
		radicalId: null,
		badges: [],
		variants: [],
		sentences: [],
		senses: [],
		forms: [],
		characters: [],
		...over
	};
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

beforeEach(() => {
	workspaces.set({ list: [], current: { id: 1, language: 'zh', name: 'zh' } as never });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	workspaces.set({ list: [], current: null });
});

describe('EntryView', () => {
	it('renders the word as the heading level it is given and records one view', async () => {
		getEntryMock.mockResolvedValue(entry());
		render(EntryView, { entryId: 5, headingLevel: 2, recordView: true });
		const heading = await screen.findByRole('heading', { level: 2, name: '勤奋' });
		expect(heading.tagName).toBe('H2');
		await waitFor(() => expect(record).toHaveBeenCalledWith('view', 1, { entryId: 5 }));
	});

	it('records no view for a preview (recordView false)', async () => {
		getEntryMock.mockResolvedValue(entry());
		render(EntryView, { entryId: 5, headingLevel: 2, recordView: false });
		await screen.findByRole('heading', { level: 2, name: '勤奋' });
		expect(record).not.toHaveBeenCalled();
	});

	it('a newer entryId wins over a slow earlier load', async () => {
		const slow = deferred<Entry>();
		getEntryMock.mockImplementation((id: number) =>
			id === 5 ? slow.promise : Promise.resolve(entry({ id: 6, written: '勤劳' }))
		);
		const view = render(EntryView, { entryId: 5, recordView: false });
		await view.rerender({ entryId: 6, recordView: false });
		await screen.findByRole('heading', { level: 1, name: '勤劳' });
		slow.resolve(entry({ id: 5, written: '勤奋' }));
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('heading', { name: '勤奋' })).toBeNull();
		expect(screen.getByRole('heading', { name: '勤劳' })).toBeTruthy();
	});
});
