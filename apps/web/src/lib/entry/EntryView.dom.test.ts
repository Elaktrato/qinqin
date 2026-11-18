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
vi.mock('$lib/components/StrokePlayer.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/study/store', async (orig) => ({
	...(await orig<typeof import('$lib/study/store')>()),
	addCard: vi.fn(async () => ({}))
}));
vi.mock('$lib/study/studyData', () => ({
	getStudyData: vi.fn(async () => ({ decks: [], cards: [], known: [] })),
	hasCard: vi.fn(() => false)
}));
vi.mock('$lib/components/EntryEditor.svelte', () => import('./testing/SaveEditor.svelte'));
vi.mock('$lib/notes/store', async (orig) => ({
	...(await orig<typeof import('$lib/notes/store')>()),
	loadNote: vi.fn(async () => null)
}));

import { fireEvent, within } from '@testing-library/svelte';
import { getEntry } from '$lib/api/entries';
import { record } from '$lib/events';
import { pageFrame } from '$lib/frame/pageFrame.svelte';
import { setUrl } from '$lib/testing/appState.svelte';
import { workspaces } from '$lib/workspaces';
import EntryView from './EntryView.svelte';
import ActionsHarness from './testing/ActionsHarness.svelte';

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
	setUrl('/');
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


describe('EntryView after an edit', () => {
	it('names the new written form through ontitle', async () => {
		setUrl('/entry/5?edit=1');
		getEntryMock.mockResolvedValue(entry());
		const titles: string[] = [];
		render(EntryView, { entryId: 5, recordView: false, ontitle: (w) => titles.push(w) });
		await fireEvent.click(await screen.findByRole('button', { name: 'Save entry' }));
		expect(titles).toContain('勤勉');
	});
});


describe('the entry header and main column (#104)', () => {
	it('shows the word large, its variant with a label, readings, chips and the actions', async () => {
		getEntryMock.mockResolvedValue(
			entry({
				written: '发',
				forms: [{ text: '发', flags: [] }, { text: '發', flags: ['trad'] }],
				variants: [
					{ id: 7, language: 'zh', kind: 'character', written: '發', readings: [], attrs: {}, radicalId: null }
				],
				readings: [{ type: 'pinyin', value: 'fā', plain: 'fa', ord: 0 }],
				badges: [{ schemeId: 1, schemeName: 'HSK', levelName: '5', derived: false }]
			})
		);
		const { container } = render(EntryView, { entryId: 5, headingLevel: 1, recordView: false });
		await screen.findByRole('heading', { level: 1, name: '发' });
		const header = container.querySelector('header')!;
		const variant = within(header).getByRole('link', { name: /發.*traditional/ });
		expect(variant.getAttribute('href')).toBe('/entry/7');
		expect(within(header).getByText('fā')).toBeTruthy();
		expect(within(header).queryByRole('heading', { name: 'Readings' })).toBeNull();
		expect(within(header).queryByRole('heading', { name: 'Badges' })).toBeNull();
		expect(within(header).getByText(/HSK/)).toBeTruthy();
		expect(within(header).getByText('Word')).toBeTruthy();
		expect(within(header).getByRole('button', { name: 'Add to deck' })).toBeTruthy();
	});

	it('puts meanings before examples before related', async () => {
		getEntryMock.mockResolvedValue(
			entry({
				senses: [{ dictionaryId: 1, dictionaryName: 'CEDICT', packId: 'c', license: '', attribution: '', gloss: 'diligent' }],
				senseGroups: [
					{
						dictionaryId: 1,
						dictionaryName: 'CEDICT',
						packId: 'c',
						license: '',
						attribution: '',
						pos: ['adj'],
						tags: [],
						glosses: ['diligent'],
						xrefs: ['勤劳']
					}
				],
				sentences: [
					{ id: 1, entryId: 5, sourcePack: 'p', userId: null, hanzi: '他勤奋。', pinyin: '', translation: '' }
				]
			})
		);
		render(EntryView, { entryId: 5, headingLevel: 1, recordView: false });
		const meanings = await screen.findByRole('heading', { name: 'Meanings · CEDICT' });
		const examples = screen.getByRole('heading', { name: 'Examples' });
		const related = screen.getByRole('heading', { name: 'Related' });
		expect(meanings.compareDocumentPosition(examples) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(examples.compareDocumentPosition(related) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});


describe('the entry on a phone (#104)', () => {
	it('puts a named Add to deck button into the page actions and takes it away on unmount', async () => {
		getEntryMock.mockResolvedValue(entry());
		const view = render(EntryView, { entryId: 5, recordView: false });
		await screen.findByRole('heading', { name: '勤奋' });
		await waitFor(() => expect(pageFrame.actions).toBeTruthy());
		const harness = render(ActionsHarness);
		await waitFor(() => expect(within(harness.container).getByRole('button', { name: 'Add to deck' })).toBeTruthy());
		view.unmount();
		cleanup();
		await waitFor(() => expect(pageFrame.actions).toBeNull());
	});
});
