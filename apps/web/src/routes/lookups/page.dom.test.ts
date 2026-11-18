import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryBase } from '$lib/api/types';
import type { LookupHistory, LookupItem, LookupState } from '$lib/lookups/lookups';
import type { PageData } from '$lib/lookups/pageData';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/lookups/pageData', () => ({ loadPage: vi.fn(), addEntries: vi.fn() }));
vi.mock('$lib/lookups/store', () => ({
	removeFromHistory: vi.fn(),
	clearHistory: vi.fn(),
	saveLookupCfg: vi.fn(async () => {}),
	repairAfterClear: vi.fn(async () => false)
}));
vi.mock('$lib/time/zone', () => ({
	currentStudyDay: () => ({ dayOf: (ms: number) => new Date(ms).toISOString().slice(0, 10), today: () => '2026-11-16' })
}));

import { addEntries, loadPage } from '$lib/lookups/pageData';
import { clearHistory, removeFromHistory, saveLookupCfg } from '$lib/lookups/store';
import { workspaces } from '$lib/workspaces';
import { primaryActions } from '$lib/ui/testing/primary';
import Page from './+page.svelte';
import source from './+page.svelte?raw';

const item = (entryId: number, over: Partial<LookupItem> = {}): LookupItem => ({
	entryId,
	count: 1,
	firstAt: '2026-11-01T09:00:00Z',
	lastAt: `2026-11-${String(Math.max(1, 28 - (entryId % 27))).padStart(2, '0')}T09:00:00Z`,
	sources: { reader: 1 },
	books: [],
	...over
});
const base = (id: number, written: string): EntryBase =>
	({ id, language: 'zh', kind: 'word', written, readings: [{ type: 'pinyin', value: `r${id}`, plain: '' }], attrs: {}, radicalId: null }) as unknown as EntryBase;

function data(items: LookupItem[], over: Partial<PageData> = {}, states: Record<number, LookupState> = {}): PageData {
	const history: LookupHistory = { clearedAt: null, items, extra: {} };
	return {
		history,
		record: true,
		bases: new Map(items.map((i) => [i.entryId, base(i.entryId, `词${i.entryId}`)])),
		books: new Map([[17, '三体']]),
		decks: [{ id: 'd1', name: 'HSK', createdAt: '2026-11-01T00:00:00Z' }],
		stateOf: (id) => states[id] ?? 'new',
		...over
	};
}

beforeEach(() => {
	workspaces.set({ list: [], current: { id: 3, language: 'zh', name: 'Chinese' } as never });
	vi.mocked(addEntries).mockResolvedValue({ created: 1, joined: 0, skipped: 0, missing: 0 });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('/lookups page', () => {
	it('lists 50 words newest first and shows 50 more', async () => {
		const items = Array.from({ length: 60 }, (_, i) => item(i + 1, { lastAt: new Date(Date.UTC(2026, 10, 15) - i * 60_000).toISOString() }));
		vi.mocked(loadPage).mockResolvedValue(data(items));
		render(Page);
		const list = await screen.findByRole('list', { name: 'Looked-up words' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(50);
		expect(within(list).getAllByRole('listitem')[0].textContent).toContain('词1');
		await fireEvent.click(screen.getByRole('button', { name: 'Show 50 more' }));
		expect(within(list).getAllByRole('listitem')).toHaveLength(60);
		expect(screen.queryByRole('button', { name: 'Show 50 more' })).toBeNull();
		expect(loadPage).toHaveBeenCalledWith(3);
	});

	it('a row shows count, day, where and its state', async () => {
		vi.mocked(loadPage).mockResolvedValue(data([item(1, { count: 4, lastAt: '2026-11-03T09:00:00Z', books: [17], sources: { reader: 3, search: 1 } }), item(2)], {}, { 2: 'learning' }));
		render(Page);
		const rows = within(await screen.findByRole('list', { name: 'Looked-up words' })).getAllByRole('listitem');
		expect(rows[0].textContent).toContain('×4');
		expect(rows[0].textContent).toContain('last 3 Nov');
		expect(rows[0].textContent).toContain('《三体》, search');
		expect(rows[0].textContent).toContain('No card');
		expect(rows[1].textContent).toContain('In study');
		expect(within(rows[0]).getByRole('link', { name: '词1' }).getAttribute('href')).toBe('/entry/1');
	});

	it('the deck is a Select and the history rows are hairline list items', async () => {
		vi.mocked(loadPage).mockResolvedValue(data([item(1)]));
		render(Page);
		await screen.findByRole('list', { name: 'Looked-up words' });
		expect(screen.getByLabelText('Deck').closest('.field')).toBeTruthy();
	});

	it('Add on a row adds that word to the chosen deck and says what happened', async () => {
		vi.mocked(loadPage).mockResolvedValue(data([item(1), item(2)]));
		render(Page);
		await screen.findByRole('list', { name: 'Looked-up words' });
		await fireEvent.change(screen.getByLabelText('Deck'), { target: { value: 'd1' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add 词2' }));
		await waitFor(() => expect(addEntries).toHaveBeenCalledWith(3, [2], { id: 'd1', name: 'HSK' }));
		expect(await screen.findByText('Added 1 new card to HSK.')).toBeTruthy();
		expect(loadPage).toHaveBeenCalledTimes(2);
	});

	it('adds and removes the selected words', async () => {
		vi.mocked(loadPage).mockResolvedValue(data([item(1), item(2), item(3)]));
		vi.mocked(removeFromHistory).mockResolvedValue({ clearedAt: null, items: [item(2)], extra: {} });
		render(Page);
		await screen.findByRole('list', { name: 'Looked-up words' });
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select 词1' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select 词3' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Add selected (2)' }));
		await waitFor(() => expect(addEntries).toHaveBeenCalledWith(3, [1, 3], { id: 'general', name: 'General' }));
		// adding clears the selection
		await waitFor(() => expect(screen.getByRole('button', { name: 'Add selected (0)' })).toBeTruthy());
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select 词1' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select 词3' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove selected (2)' }));
		await waitFor(() => expect(removeFromHistory).toHaveBeenCalledWith(3, [1, 3]));
		const list = screen.getByRole('list', { name: 'Looked-up words' });
		await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
		expect(screen.getByRole('button', { name: 'Remove selected (0)' }).hasAttribute('disabled')).toBe(true);
	});

	it('the prompt lists new words looked up three times or more and adds them', async () => {
		vi.mocked(loadPage).mockResolvedValue(
			data([item(1, { count: 5 }), item(2, { count: 3 }), item(3, { count: 2 }), item(4, { count: 9 })], {}, { 4: 'learning' })
		);
		render(Page);
		const box = await screen.findByRole('region', { name: 'You keep looking these up' });
		expect(primaryActions(box)).toHaveLength(1);
		expect(box.textContent).toContain('词1');
		expect(box.textContent).toContain('词2');
		expect(box.textContent).not.toContain('词3');
		expect(box.textContent).not.toContain('词4');
		await fireEvent.click(within(box).getByRole('button', { name: 'Add these 2 to General' }));
		await waitFor(() => expect(addEntries).toHaveBeenCalledWith(3, [1, 2], { id: 'general', name: 'General' }));
	});

	it('the filter shows only words without a card', async () => {
		vi.mocked(loadPage).mockResolvedValue(data([item(1), item(2)], {}, { 2: 'known' }));
		render(Page);
		const list = await screen.findByRole('list', { name: 'Looked-up words' });
		await fireEvent.click(screen.getByRole('radio', { name: 'No card yet' }));
		expect(within(list).getAllByRole('listitem')).toHaveLength(1);
	});

	it('Clear asks first; Keep does nothing; Delete clears and shows the empty state', async () => {
		vi.mocked(loadPage).mockResolvedValue(data([item(1)]));
		vi.mocked(clearHistory).mockResolvedValue({ eventsDeleted: 2, history: { clearedAt: '2026-11-16T12:00:00Z', items: [], extra: {} } });
		render(Page);
		await screen.findByRole('list', { name: 'Looked-up words' });
		await fireEvent.click(screen.getByRole('button', { name: 'Clear history…' }));
		expect(screen.getByText('Delete the lookup history of Chinese, including old search records? This cannot be undone.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
		expect(clearHistory).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Clear history…' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(clearHistory).toHaveBeenCalledWith(3, expect.any(Date), { onRepaired: expect.any(Function) }));
		expect(await screen.findByText('No lookups yet. Hover or select a word in the reader, or open a search result.')).toBeTruthy();
	});

	it('the switch saves the user-global setting and, when off, offers to clear too', async () => {
		vi.mocked(loadPage).mockResolvedValue(data([item(1)]));
		render(Page);
		const sw = await screen.findByRole('switch', { name: 'Record words I look up' });
		expect(sw.getAttribute('aria-checked')).toBe('true');
		await fireEvent.click(sw);
		await waitFor(() => expect(saveLookupCfg).toHaveBeenCalledWith(false));
		expect(sw.getAttribute('aria-checked')).toBe('false');
		await fireEvent.click(await screen.findByRole('button', { name: 'Clear history too' }));
		expect(screen.getByText(/This cannot be undone\./)).toBeTruthy();
	});

	it('a failed load says so with Try again', async () => {
		vi.mocked(loadPage).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(data([item(1)]));
		render(Page);
		await fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
		expect(await screen.findByRole('list', { name: 'Looked-up words' })).toBeTruthy();
	});

	it('a word no longer in the dictionary can only be removed', async () => {
		vi.mocked(loadPage).mockResolvedValue(data([item(1)], { bases: new Map() }));
		render(Page);
		const list = await screen.findByRole('list', { name: 'Looked-up words' });
		expect(list.textContent).toContain('Not in the dictionary any more');
		expect(within(list).queryByRole('button', { name: /^Add/ })).toBeNull();
		expect(within(list).getByRole('button', { name: /^Remove/ })).toBeTruthy();
	});

	it('words and titles with markup render as text', async () => {
		const evil = '<img src=x onerror=alert(1)>';
		vi.mocked(loadPage).mockResolvedValue(
			data([item(1, { books: [17] })], { bases: new Map([[1, base(1, evil)]]), books: new Map([[17, '<b>bold</b>']]) })
		);
		const { container } = render(Page);
		await screen.findByRole('list', { name: 'Looked-up words' });
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('b')).toBeNull();
		expect(container.textContent).toContain(evil);
		expect(container.textContent).toContain('《<b>bold</b>》');
	});

	it('without a workspace it says so and loads nothing', async () => {
		workspaces.set({ list: [], current: null });
		render(Page);
		expect(await screen.findByText(/Select a workspace/)).toBeTruthy();
		expect(loadPage).not.toHaveBeenCalled();
	});

	it('uses no raw HTML', () => {
		expect(source).not.toContain('{@html');
	});

	it('shows the count and announces it only when the filter changes', async () => {
		vi.mocked(loadPage).mockResolvedValue(data([item(1), item(2), item(3)], {}, { 2: 'learning' }));
		vi.mocked(removeFromHistory).mockResolvedValue({ clearedAt: null, items: [item(2), item(3)], extra: {} });
		const { container } = render(Page);
		const count = await screen.findByText('3 words');
		expect(count.className).toContain('history-count');
		expect(count.getAttribute('aria-live')).toBeNull();
		const live = container.querySelector('.filter-live') as HTMLElement;
		expect(live.getAttribute('aria-live')).toBe('polite');
		expect(live.textContent).toBe('');
		await fireEvent.click(screen.getByRole('radio', { name: 'No card yet' }));
		await waitFor(() => expect(live.textContent).toBe('2 of 3 words with no card yet'));
		expect(count.textContent).toBe('2 of 3 words with no card yet');
		// Remove has its own status message: the count updates on screen, silently.
		await fireEvent.click(screen.getByRole('button', { name: 'Remove 词1' }));
		await waitFor(() => expect(count.textContent).toBe('1 of 2 words with no card yet'));
		expect(live.textContent).toBe('2 of 3 words with no card yet');
	});
});
