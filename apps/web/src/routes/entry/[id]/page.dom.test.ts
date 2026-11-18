import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '$lib/api/types';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/entries', () => ({
	getEntry: vi.fn(),
	getCharsUnderRadical: vi.fn(),
	getSharedEntry: vi.fn()
}));
vi.mock('$lib/events', () => ({
	record: vi.fn(),
	loadWorkspaceEvents: vi.fn(async () => []),
	onEventLogChange: vi.fn(() => () => {})
}));
vi.mock('$lib/components/AddToStudy.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/components/StrokePlayer.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/api/audio', () => ({ getEntryAudio: vi.fn(async () => ({ terms: [], syllables: null })) }));
vi.mock('$lib/api/frequency', () => ({ getEntryRanks: vi.fn(async () => ({ pack: null, ranks: [] })) }));
vi.mock('$lib/notes/store', async (orig) => ({
	...(await orig<typeof import('$lib/notes/store')>()),
	loadNote: vi.fn(async () => ({ entryId: 5, text: 'my mnemonic', extra: {} }))
}));

import { getCharsUnderRadical, getEntry, getSharedEntry } from '$lib/api/entries';
import { ApiError } from '$lib/api/client';
import { pageFrame } from '$lib/frame/pageFrame.svelte';
import { page, setUrl } from '$lib/testing/appState.svelte';
import { loadNote } from '$lib/notes/store';
import { workspaces } from '$lib/workspaces';
import type { Workspace } from '$lib/api/types';
import Page from './+page.svelte';

function entry(over: Partial<Entry> = {}): Entry {
	return {
		id: 5,
		language: 'zh',
		kind: 'character',
		written: '你',
		readings: [{ type: 'pinyin', value: 'ni3', plain: 'ni', ord: 0 }],
		radicalId: null,
		badges: [],
		variants: [],
		sentences: [],
		senses: [],
		...over
	} as Entry;
}

beforeEach(() => {
	(page as unknown as { params: Record<string, string> }).params = { id: '5' };
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	workspaces.set({ list: [], current: null });
	setUrl('/');
});

describe('entry page robustness', () => {
	it('still shows the entry when the optional /chars request fails', async () => {
		vi.mocked(getEntry).mockResolvedValue(entry());
		vi.mocked(getCharsUnderRadical).mockRejectedValue(new Error('chars down'));
		render(Page);
		expect(await screen.findByRole('heading', { name: '你' })).toBeTruthy();
		// Let the failing optional request settle before asserting nothing broke.
		await waitFor(() => expect(getCharsUnderRadical).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByRole('heading', { name: '你' })).toBeTruthy();
	});

	it('does not request /chars for a word', async () => {
		vi.mocked(getEntry).mockResolvedValue(entry({ kind: 'word', written: '你好' }));
		render(Page);
		await screen.findByRole('heading', { name: '你好' });
		expect(getCharsUnderRadical).not.toHaveBeenCalled();
	});

	it('lists characters under a radical with formatted readings', async () => {
		vi.mocked(getEntry).mockResolvedValue(entry({ id: 5, written: '亻' }));
		vi.mocked(getCharsUnderRadical).mockResolvedValue([
			{ id: 6, language: 'zh', kind: 'character', written: '他', readings: [{ type: 'pinyin', value: 'ta1', plain: 'ta', ord: 0 }] }
		] as never);
		render(Page);
		const link = await screen.findByRole('link', { name: '他' });
		// Same display form as the main readings section (formatReading).
		expect(link.parentElement?.textContent).toContain('Pinyin: ta1');
	});

	it('shows the radical by its written form', async () => {
		vi.mocked(getEntry).mockImplementation((async (id: number) =>
			id === 9 ? entry({ id: 9, written: '亻' }) : entry({ radicalId: 9 })) as never);
		vi.mocked(getCharsUnderRadical).mockResolvedValue([]);
		render(Page);
		expect(await screen.findByRole('link', { name: /亻/ })).toBeTruthy();
		await waitFor(() => expect(screen.queryByText(/Radical entry #9/)).toBeNull());
	});

	it('keeps the page and falls back to the id when the radical fetch fails', async () => {
		vi.mocked(getEntry).mockImplementation((async (id: number) => {
			if (id === 9) throw new Error('radical down');
			return entry({ radicalId: 9 });
		}) as never);
		vi.mocked(getCharsUnderRadical).mockResolvedValue([]);
		render(Page);
		expect(await screen.findByRole('heading', { name: '你' })).toBeTruthy();
		expect(await screen.findByRole('link', { name: 'Radical entry #9' })).toBeTruthy();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('shows a variant small beside the word with its label as a link', async () => {
		vi.mocked(getEntry).mockResolvedValue(
			entry({
				kind: 'word',
				forms: [{ text: '你', flags: [] }, { text: '妳', flags: ['trad'] }],
				variants: [
					{ id: 7, language: 'zh', kind: 'word', written: '妳', readings: [{ type: 'pinyin', value: 'ni3', plain: 'ni', ord: 0 }] }
				] as never
			})
		);
		render(Page);
		const link = await screen.findByRole('link', { name: '妳 (traditional)' });
		expect(link.getAttribute('href')).toBe('/entry/7');
	});

	it('links a character to all characters with its radical', async () => {
		vi.mocked(getEntry).mockImplementation((async (id: number) =>
			id === 9 ? entry({ id: 9, language: 'ja', written: '言' }) : entry({ language: 'ja', written: '語', radicalId: 9 })) as never);
		vi.mocked(getCharsUnderRadical).mockResolvedValue([]);
		render(Page);
		const link = await screen.findByRole('link', { name: 'All characters with this radical' });
		expect(link.getAttribute('href')).toBe('/search/parts?r=149');
	});

	it('a radical entry offers browsing by stroke count', async () => {
		vi.mocked(getEntry).mockResolvedValue(entry({ id: 5, written: '水' }));
		vi.mocked(getCharsUnderRadical).mockResolvedValue([
			{ id: 6, language: 'zh', kind: 'character', written: '河', readings: [] }
		] as never);
		render(Page);
		const link = await screen.findByRole('link', { name: 'Browse by stroke count' });
		expect(link.getAttribute('href')).toBe('/search/parts?r=85');
	});
});

describe('entry page note', () => {
	const ws = { id: 3, language: 'zh', name: '', settings: {}, updatedAt: '' } as unknown as Workspace;

	it('shows the note section of the current workspace under the senses', async () => {
		workspaces.set({ list: [ws], current: ws });
		vi.mocked(getEntry).mockResolvedValue(
			entry({
				kind: 'word',
				written: '马',
				senses: [{ dictionaryId: 1, dictionaryName: 'D', license: '', attribution: '', gloss: 'horse' }] as never
			})
		);
		render(Page);
		const text = await screen.findByTestId('note-text');
		expect(text.textContent).toBe('my mnemonic');
		expect(loadNote).toHaveBeenCalledWith(3, 5);
		const section = screen.getByRole('region', { name: 'Your note' });
		const senses = screen.getByRole('region', { name: 'Senses' });
		expect(senses.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('hides the note while the entry editor is open', async () => {
		workspaces.set({ list: [ws], current: ws });
		setUrl('/entry/5?edit=1');
		vi.mocked(getEntry).mockResolvedValue(entry({ kind: 'word', written: '马' }));
		vi.mocked(getSharedEntry).mockResolvedValue(entry({ kind: 'word', written: '马' }) as never);
		render(Page);
		await screen.findByRole('heading', { name: '马' });
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('region', { name: 'Your note' })).toBeNull();
	});

	it('has no note section without a current workspace', async () => {
		vi.mocked(getEntry).mockResolvedValue(entry({ kind: 'word', written: '马' }));
		render(Page);
		await screen.findByRole('heading', { name: '马' });
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('region', { name: 'Your note' })).toBeNull();
		expect(loadNote).not.toHaveBeenCalled();
	});
});

describe('entry page written forms', () => {
	it('lists the other written forms of a word shown in kana, never a search-only one', async () => {
		vi.mocked(getEntry).mockResolvedValue(
			entry({
				language: 'ja',
				kind: 'word',
				written: 'こと',
				readings: [{ type: 'kana', value: 'こと', plain: 'こと', ord: 0 }],
				forms: [
					{ text: '事', flags: [] },
					{ text: '縡', flags: ['oK'] },
					{ text: '乃', flags: ['sK'] }
				]
			})
		);
		render(Page);
		await screen.findByRole('heading', { name: 'こと' });
		const line = screen.getByText(/Also written/);
		expect(line.textContent).toBe('Also written: 事、縡');
	});

	it('says nothing when the headword is the only form', async () => {
		vi.mocked(getEntry).mockResolvedValue(
			entry({ language: 'ja', kind: 'word', written: '犬', forms: [{ text: '犬', flags: [] }] })
		);
		render(Page);
		await screen.findByRole('heading', { name: '犬' });
		expect(screen.queryByText(/Also written/)).toBeNull();
	});
});


describe('entry page titles and the phone bar (#104)', () => {
	it('names the frame and the document after the word', async () => {
		vi.mocked(getEntry).mockResolvedValue(entry({ written: '你' }));
		render(Page);
		await screen.findByRole('heading', { name: '你' });
		await waitFor(() => expect(pageFrame.title).toBe('你'));
		expect(document.title).toBe('你 · qinqin');
	});

	it('does not say "not found" while the entry is loading or after a network error', async () => {
		let reject!: (e: unknown) => void;
		vi.mocked(getEntry).mockReturnValue(
			new Promise((_, rej) => {
				reject = rej;
			}) as never
		);
		render(Page);
		await tick();
		expect(document.title).toBe('qinqin');
		reject(new ApiError(500, 'down'));
		await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
		expect(document.title).toBe('qinqin');
	});

	it('says "Entry not found" on a 404 and never keeps the previous word', async () => {
		vi.mocked(getEntry).mockImplementation((async (id: number) => {
			if (id === 999) throw new ApiError(404, 'not found');
			return entry({ written: '你' });
		}) as never);
		render(Page);
		await screen.findByRole('heading', { name: '你' });
		expect(document.title).toBe('你 · qinqin');
		(page as unknown as { params: Record<string, string> }).params = { id: '999' };
		await tick();
		await waitFor(() => expect(document.title).toBe('Entry not found · qinqin'));
		expect(pageFrame.title === null || pageFrame.title === '').toBe(true);
	});
});
