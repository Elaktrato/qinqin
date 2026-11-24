import { EventLog } from '$lib/events';
import type { MockInstance } from 'vitest';
import { testContext, type TestContext, workspacesState } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, SearchHit } from '$lib/api/types';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/search', () => ({ search: vi.fn() }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(() => Promise.resolve([])) }));
vi.mock('$lib/api/entries', () => ({
	getEntry: vi.fn(),
	getCharsUnderRadical: vi.fn(async () => []),
	getSharedEntry: vi.fn()
}));
vi.mock('$lib/lookups/sink', () => ({ recordLookup: vi.fn() }));
vi.mock('$lib/components/AddToStudy.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/components/StrokePlayer.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/notes/store', async (orig) => ({
	...(await orig<typeof import('$lib/notes/store')>()),
	loadNote: vi.fn(async () => null)
}));
vi.mock('$lib/api/audio', () => ({ getEntryAudio: vi.fn(async () => ({ terms: [], syllables: null })) }));
vi.mock('$lib/api/frequency', () => ({
	getEntryRanks: vi.fn(async () => ({ pack: null, ranks: [] }))
}));

import { goto } from '$app/navigation';
import { getEntry } from '$lib/api/entries';
import { recordLookup } from '$lib/lookups/sink';
import { search } from '$lib/api/search';
import { getSchemes } from '$lib/api/schemes';
import { PHONE_MEDIA_QUERY, FRAME_PHONE_BREAKPOINT } from '$lib/frame/breakpoint';
import { setUrl } from '$lib/testing/appState.svelte';
import Page from './+page.svelte';

// The session's event log (record 0009): its methods, faked on the class.
let record!: MockInstance<EventLog['record']>;
beforeEach(() => {
	vi.spyOn(EventLog.prototype, 'load').mockImplementation((async () => []) as never);
	vi.spyOn(EventLog.prototype, 'onChange').mockImplementation((() => () => {}) as never);
	record = vi.spyOn(EventLog.prototype, 'record').mockImplementation((async () => {}) as never);
});

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const searchMock = vi.mocked(search);
const getEntryMock = vi.mocked(getEntry);

function hit(id: number, written: string): SearchHit {
	return { id, written, readings: [], source: 'written' } as unknown as SearchHit;
}

function entry(id: number, written: string): Entry {
	return {
		id,
		language: 'zh',
		kind: 'word',
		written,
		readings: [{ type: 'pinyin', value: 'fu4', plain: 'fu', ord: 0 }],
		attrs: {},
		radicalId: null,
		badges: [],
		variants: [],
		sentences: [],
		senses: [],
		forms: [],
		characters: []
	};
}

/** setViewport mimics the frame's one switch: the phone by default. */
function setViewport(phone: boolean): void {
	const media = phone
		? PHONE_MEDIA_QUERY
		: `(min-width: ${FRAME_PHONE_BREAKPOINT}px)`;
	vi.stubGlobal(
		'matchMedia',
		vi.fn((q: string) => ({
			matches: q === media,
			media: q,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn()
		}))
	);
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	setUrl('/search');
	setViewport(true);
	getEntryMock.mockRejectedValue(new Error('no entry stubbed'));
	ctx.session.workspaces.set({
		list: [],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('search page', () => {
	it('mirrors the URL query into the input and searches it', async () => {
		searchMock.mockResolvedValue([hit(1, '你好')]);
		setUrl('/search?q=nihao');
		render(Page, { context: ctx.context });
		const input = screen.getByLabelText('Search entries') as HTMLInputElement;
		await waitFor(() => expect(input.value).toBe('nihao'));
		expect(searchMock).toHaveBeenCalledWith('zh', 'nihao', expect.anything());
		expect(await screen.findByText('你好')).toBeTruthy();
	});

	it('submitting navigates to the trimmed query', async () => {
		render(Page, { context: ctx.context });
		const input = screen.getByLabelText('Search entries');
		await fireEvent.input(input, { target: { value: '  ni  ' } });
		await fireEvent.submit(input.closest('form')!);
		expect(vi.mocked(goto).mock.calls[0][0]).toBe('/search?q=ni');
	});

	it('with e the split marks the selection and links back to the list', async () => {
		searchMock.mockResolvedValue([hit(7, '勤奋')]);
		setUrl('/search?q=qin&e=7');
		render(Page, { context: ctx.context });
		await screen.findByText('勤奋');
		expect(document.querySelector('.split')?.classList.contains('has-selection')).toBe(true);
		const back = screen.getByRole('link', { name: 'Back to results' });
		expect(back.getAttribute('href')).toBe('/search?q=qin');
	});

	it('shows the URL entry even when it is not among the hits, and records that entry', async () => {
		searchMock.mockResolvedValue([hit(7, '勤奋')]);
		getEntryMock.mockImplementation(async (id: number) =>
			id === 9 ? entry(9, '覆') : entry(7, '勤奋')
		);
		setUrl('/search?q=cover&e=9');
		render(Page, { context: ctx.context });
		const heading = await screen.findByRole('heading', { level: 2, name: '覆' });
		expect(heading.textContent).toBe('覆');
		await waitFor(() => expect(record).toHaveBeenCalledWith('view', 1, { entryId: 9 }));
		expect(record).not.toHaveBeenCalledWith('view', 1, { entryId: 7 });
		expect(document.title).toBe('覆 · Search · qinqin');
	});

	it('with e and no q shows the entry, its Back link and no search', async () => {
		getEntryMock.mockResolvedValue(entry(9, '覆'));
		setUrl('/search?e=9');
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('heading', { level: 2, name: '覆' })).toBeTruthy();
		expect(searchMock).not.toHaveBeenCalled();
		expect(screen.getByRole('link', { name: 'Back to results' }).getAttribute('href')).toBe('/search');
		expect(document.querySelector('.split')?.classList.contains('has-selection')).toBe(true);
	});

	it('keeps the URL entry when a filter change returns no hits (phone: Back stays)', async () => {
		searchMock.mockResolvedValue([]);
		getEntryMock.mockResolvedValue(entry(9, '覆'));
		setUrl('/search?q=cover&kind=character&e=9');
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('heading', { level: 2, name: '覆' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Back to results' }).getAttribute('href')).toBe(
			'/search?q=cover&kind=character'
		);
	});

	it('with e and a failed search still shows the entry and the Back link', async () => {
		searchMock.mockRejectedValue(new Error('search down'));
		getEntryMock.mockResolvedValue(entry(9, '覆'));
		setUrl('/search?q=cover&e=9');
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('heading', { level: 2, name: '覆' })).toBeTruthy();
		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Back to results' })).toBeTruthy();
	});

	it('without e previews the first result on a wide screen, records no view and marks no row', async () => {
		setViewport(false);
		searchMock.mockResolvedValue([hit(7, '勤奋'), hit(8, '勤劳')]);
		getEntryMock.mockResolvedValue(entry(7, '勤奋'));
		setUrl('/search?q=qin');
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('heading', { level: 2, name: '勤奋' })).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Back to results' })).toBeNull();
		expect(document.querySelector('[aria-current="true"]')).toBeNull();
		expect(record).not.toHaveBeenCalled();
		expect(document.title).toBe('Search · qinqin');
	});

	it('clicking a result selects it in the URL and records one lookup', async () => {
		searchMock.mockResolvedValue([hit(7, '勤奋')]);
		setUrl('/search?q=qin');
		render(Page, { context: ctx.context });
		const link = await screen.findByRole('link', { name: '勤奋' });
		await fireEvent.click(link);
		expect(vi.mocked(goto).mock.calls[0][0]).toBe('/search?q=qin&e=7');
		expect(recordLookup).toHaveBeenCalledTimes(1);
	});

	it('on a phone a click pushes the URL, scrolls to the top and focuses the entry heading', async () => {
		searchMock.mockResolvedValue([hit(7, '勤奋')]);
		getEntryMock.mockResolvedValue(entry(7, '勤奋'));
		setUrl('/search?q=qin');
		render(Page, { context: ctx.context });
		const link = await screen.findByRole('link', { name: '勤奋' });
		await fireEvent.click(link);
		expect(vi.mocked(goto).mock.calls[0][1]).toEqual({
			replaceState: false,
			keepFocus: false,
			noScroll: false
		});
		// The goto itself is mocked: follow its URL as the browser would.
		setUrl('/search?q=qin&e=7');
		await tick();
		const heading = await screen.findByRole('heading', { level: 2, name: '勤奋' });
		await waitFor(() => expect(document.activeElement).toBe(heading));
	});

	it('on a wide screen a click replaces the URL and keeps focus on the row', async () => {
		setViewport(false);
		searchMock.mockResolvedValue([hit(7, '勤奋')]);
		setUrl('/search?q=qin');
		render(Page, { context: ctx.context });
		const link = await screen.findByRole('link', { name: '勤奋' });
		link.focus();
		await fireEvent.click(link);
		expect(vi.mocked(goto).mock.calls[0][1]).toEqual({
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
		expect(document.activeElement).toBe(link);
	});

	it('Arrow keys, Home and End move between rows; one row is the tab stop', async () => {
		searchMock.mockResolvedValue([hit(1, 'a'), hit(2, 'b'), hit(3, 'c')]);
		setUrl('/search?q=x');
		render(Page, { context: ctx.context });
		const rows = await screen.findAllByRole('link', { name: /^[abc]$/ });
		expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
		rows[0].focus();
		await fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
		expect(document.activeElement).toBe(rows[1]);
		await fireEvent.keyDown(rows[1], { key: 'ArrowUp' });
		expect(document.activeElement).toBe(rows[0]);
		await fireEvent.keyDown(rows[0], { key: 'End' });
		expect(document.activeElement).toBe(rows[2]);
		expect(rows[2].getAttribute('tabindex')).toBe('0');
		await fireEvent.keyDown(rows[2], { key: 'Home' });
		expect(document.activeElement).toBe(rows[0]);
		expect(rows[0].getAttribute('tabindex')).toBe('0');
	});

	it('Back to results returns focus to the row that was selected', async () => {
		searchMock.mockResolvedValue([hit(7, '勤奋'), hit(8, '勤劳')]);
		getEntryMock.mockResolvedValue(entry(8, '勤劳'));
		setUrl('/search?q=qin&e=8');
		render(Page, { context: ctx.context });
		await screen.findByRole('heading', { level: 2, name: '勤劳' });
		expect(screen.getByRole('link', { name: 'Back to results' }).getAttribute('href')).toBe('/search?q=qin');
		// Follow the link as the browser would.
		setUrl('/search?q=qin');
		await tick();
		const row = await screen.findByRole('link', { name: '勤劳' });
		await waitFor(() => expect(document.activeElement).toBe(row));
	});

	it('keeps the announced count after a selection', async () => {
		searchMock.mockResolvedValue([hit(7, '勤奋'), hit(8, '勤劳')]);
		getEntryMock.mockResolvedValue(entry(7, '勤奋'));
		setUrl('/search?q=qin');
		render(Page, { context: ctx.context });
		const status = await screen.findByRole('status');
		await waitFor(() => expect(status.textContent).toBe('2 results for “qin”.'));
		await fireEvent.click(await screen.findByRole('link', { name: '勤奋' }));
		expect(status.textContent).toBe('2 results for “qin”.');
	});

	it('ignores a stale response that resolves after a newer search', async () => {
		const first = deferred<SearchHit[]>();
		const second = deferred<SearchHit[]>();
		searchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		setUrl('/search?q=a');
		render(Page, { context: ctx.context });
		await tick();
		setUrl('/search?q=b');
		await tick();
		second.resolve([hit(2, 'NEW')]);
		await screen.findByText('NEW');
		first.resolve([hit(1, 'OLD')]);
		await tick();
		await Promise.resolve();
		expect(screen.queryByText('OLD')).toBeNull();
		expect(screen.getByText('NEW')).toBeTruthy();
	});

	it('announces the result count in a polite live region', async () => {
		searchMock.mockResolvedValue([hit(1, 'a'), hit(2, 'b')]);
		setUrl('/search?q=x');
		render(Page, { context: ctx.context });
		const status = await screen.findByRole('status');
		await waitFor(() => expect(status.textContent).toBe('2 results for “x”.'));
		expect(status.getAttribute('aria-live')).toBe('polite');
	});

	it('announces an empty result and a single result', async () => {
		searchMock.mockResolvedValueOnce([hit(1, 'a')]);
		setUrl('/search?q=x');
		render(Page, { context: ctx.context });
		const status = await screen.findByRole('status');
		await waitFor(() => expect(status.textContent).toBe('1 result for “x”.'));
		searchMock.mockResolvedValueOnce([]);
		setUrl('/search?q=y');
		await waitFor(() => expect(status.textContent).toBe('No results for “y”.'));
	});

	it('submitting the same query again searches again (a refresh)', async () => {
		searchMock.mockResolvedValue([hit(1, 'a')]);
		setUrl('/search?q=ni');
		render(Page, { context: ctx.context });
		await screen.findByText('a');
		expect(searchMock).toHaveBeenCalledTimes(1);
		const input = screen.getByLabelText('Search entries');
		await fireEvent.submit(input.closest('form')!);
		await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
		expect(goto).not.toHaveBeenCalled();
	});

	it('submitting the same text drops e and navigates to the URL without it', async () => {
		searchMock.mockResolvedValue([hit(7, '勤奋')]);
		getEntryMock.mockResolvedValue(entry(7, '勤奋'));
		setUrl('/search?q=qin&e=7');
		render(Page, { context: ctx.context });
		await screen.findByRole('heading', { level: 2, name: '勤奋' });
		const input = screen.getByLabelText('Search entries');
		await fireEvent.submit(input.closest('form')!);
		expect(vi.mocked(goto).mock.calls[0][0]).toBe('/search?q=qin');
	});

	it('puts the trimmed query back into the input on submit', async () => {
		searchMock.mockResolvedValue([]);
		setUrl('/search?q=ni');
		render(Page, { context: ctx.context });
		const input = screen.getByLabelText('Search entries') as HTMLInputElement;
		await waitFor(() => expect(input.value).toBe('ni'));
		await fireEvent.input(input, { target: { value: '  ni  ' } });
		await fireEvent.submit(input.closest('form')!);
		await waitFor(() => expect(input.value).toBe('ni'));
	});

	it('handles a rejected navigation on submit (no unhandled rejection)', async () => {
		const rejected = Promise.reject(new Error('superseded'));
		const handled = vi.spyOn(rejected, 'catch');
		vi.mocked(goto).mockReturnValueOnce(rejected as never);
		render(Page, { context: ctx.context });
		const input = screen.getByLabelText('Search entries');
		await fireEvent.input(input, { target: { value: 'ni' } });
		await fireEvent.submit(input.closest('form')!);
		expect(handled).toHaveBeenCalled();
	});

	it('says when the result list is capped at 50', async () => {
		searchMock.mockResolvedValue(Array.from({ length: 50 }, (_, i) => hit(i + 1, `w${i}`)));
		setUrl('/search?q=x');
		render(Page, { context: ctx.context });
		expect(await screen.findByText(/Showing the first 50 results/)).toBeTruthy();
	});

	it('says workspaces are loading, not that none is selected, while they load', async () => {
		ctx.session.workspaces.set({ list: [], current: null });
		ctx.session.workspaces.set(workspacesState(ctx.session.workspaces), false);
		render(Page, { context: ctx.context });
		expect((screen.getByLabelText('Search entries') as HTMLInputElement).placeholder).toBe(
			'Loading workspaces…'
		);
	});

	it('disables the search input and says why when there is no workspace', async () => {
		ctx.session.workspaces.set({ list: [], current: null });
		ctx.session.workspaces.set(workspacesState(ctx.session.workspaces), true);
		render(Page, { context: ctx.context });
		expect((screen.getByLabelText('Search entries') as HTMLInputElement).placeholder).toBe(
			'Select a workspace to search'
		);
		expect((screen.getByLabelText('Search entries') as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('links the radical and part lookup in ja and zh workspaces only', async () => {
		render(Page, { context: ctx.context });
		const link = await screen.findByRole('link', { name: 'By parts' });
		expect(link.getAttribute('href')).toBe('/search/parts');
		cleanup();
		ctx.session.workspaces.set({ list: [], current: { id: 2, language: 'es', name: 'es' } as never });
		render(Page, { context: ctx.context });
		await tick();
		expect(screen.queryByRole('link', { name: 'By parts' })).toBeNull();
	});

	it('records no lookup event for a query (#72)', async () => {
		searchMock.mockResolvedValue([hit(1, '你好')]);
		setUrl('/search?q=nihao');
		render(Page, { context: ctx.context });
		await screen.findByText('你好');
		expect(record).not.toHaveBeenCalled();
		expect(recordLookup).not.toHaveBeenCalled();
	});

	it('opening a result records it once in the lookup history, source search', async () => {
		searchMock.mockResolvedValue([hit(7, '你好'), hit(8, '世界')]);
		setUrl('/search?q=ni');
		render(Page, { context: ctx.context });
		const link = await screen.findByText('你好');
		link.addEventListener('click', (e) => e.preventDefault());
		await fireEvent.click(link);
		expect(recordLookup).toHaveBeenCalledExactlyOnceWith(1, { entryId: 7, source: 'search' });
	});

	it('links the lookup history', async () => {
		render(Page, { context: ctx.context });
		expect(screen.getByRole('link', { name: 'Lookup history' }).getAttribute('href')).toBe('/lookups');
		const source = (await import('./+page.svelte?raw')).default as string;
		expect(source).toMatch(/\.parts-link a\s*\{[^}]*color:\s*var\(--reading-accent\)/);
		expect(source).toMatch(/\.parts-link a\s*\{[^}]*text-decoration:\s*underline/);
	});

	it('a middle-click open records too; a right-button auxclick does not', async () => {
		searchMock.mockResolvedValue([hit(7, '你好')]);
		setUrl('/search?q=ni');
		render(Page, { context: ctx.context });
		const link = await screen.findByText('你好');
		await fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 2 }));
		expect(recordLookup).not.toHaveBeenCalled();
		await fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
		expect(recordLookup).toHaveBeenCalledExactlyOnceWith(1, { entryId: 7, source: 'search' });
	});

	it('a middle-click records the lookup and leaves the browser to open its tab', async () => {
		searchMock.mockResolvedValue([hit(7, '你好')]);
		setUrl('/search?q=ni');
		render(Page, { context: ctx.context });
		const link = await screen.findByText('你好');
		const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
		expect(link.dispatchEvent(event)).toBe(true);
		expect(recordLookup).toHaveBeenCalledExactlyOnceWith(1, { entryId: 7, source: 'search' });
		expect(goto).not.toHaveBeenCalled();
	});
});


describe('the search field and filters (#104)', () => {
	const schemes = [
		{
			id: 1,
			name: 'HSK',
			unit: 'character',
			language: 'zh',
			packId: 'hsk',
			levels: [
				{ id: 1, ord: 0, name: '1' },
				{ id: 2, ord: 1, name: '3' }
			]
		}
	];

	it('is an underline field with a named submit IconButton and a By parts IconButton', async () => {
		render(Page, { context: ctx.context });
		const form = screen.getByRole('search');
		const input = screen.getByLabelText('Search entries');
		expect(form.contains(input)).toBe(true);
		const submit = screen.getByRole('button', { name: 'Search' });
		expect(submit.closest('form')).toBe(form);
		expect(submit.className).not.toContain('primary');
		const parts = await screen.findByRole('link', { name: 'By parts' });
		expect(parts.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe('By parts');
	});

	it('All, Words and Characters are text buttons with aria-pressed; All clears the kind', async () => {
		searchMock.mockResolvedValue([]);
		setUrl('/search?q=x&kind=word');
		render(Page, { context: ctx.context });
		const all = await screen.findByRole('button', { name: 'All' });
		expect(all.getAttribute('aria-pressed')).toBe('false');
		expect(screen.getByRole('button', { name: 'Words' }).getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(all);
		expect(vi.mocked(goto).mock.calls[0][0]).toBe('/search?q=x');
	});

	it('Level: any opens a Menu with Any level and the schemes levels; a pick sets both and keeps e', async () => {
		vi.mocked(getSchemes).mockResolvedValue(schemes as never);
		searchMock.mockResolvedValue([hit(7, '勤奋')]);
		getEntryMock.mockResolvedValue(entry(7, '勤奋'));
		setUrl('/search?q=x&e=7');
		render(Page, { context: ctx.context });
		const trigger = await screen.findByRole('button', { name: /Level: any/ });
		await fireEvent.click(trigger);
		expect(screen.getByRole('menuitemradio', { name: 'Any level' })).toBeTruthy();
		await fireEvent.click(await screen.findByRole('menuitemradio', { name: 'HSK 1' }));
		expect(vi.mocked(goto).mock.calls.at(-1)?.[0]).toBe('/search?q=x&scheme=hsk&level=1&e=7');
	});

	it('Escape in the level Menu returns focus to its button', async () => {
		vi.mocked(getSchemes).mockResolvedValue(schemes as never);
		render(Page, { context: ctx.context });
		const trigger = await screen.findByRole('button', { name: /Level: any/ });
		await fireEvent.click(trigger);
		await fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' });
		expect(document.activeElement).toBe(trigger);
	});

	it('shows Clear filters only when a filter is set', async () => {
		render(Page, { context: ctx.context });
		expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
		cleanup();
		setUrl('/search?q=x&kind=word');
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeTruthy();
	});

	it('draws the filters as text with a 1.5px accent underline, no border', async () => {
		const source = (await import('./+page.svelte?raw')).default as string;
		expect(source).toMatch(/\.chip\[aria-pressed='true'\]\s*\{[^}]*box-shadow:\s*inset 0 -1\.5px 0 var\(--accent\)/);
		expect(source).toMatch(/\.chip,[\s\S]*?border:\s*0/);
	});
});


describe('the search layout switch (#104)', () => {
	it('uses the frame 720px switch in the CSS and the script', async () => {
		const source = (await import('./+page.svelte?raw')).default as string;
		expect(source).toContain('max-width: 719.98px');
		expect(source).toContain('min-width: 720px');
		expect(source).toContain('PHONE_MEDIA_QUERY');
		expect(source).not.toContain('45rem');
	});

	it('does not fetch the preview that the phone hides', async () => {
		searchMock.mockResolvedValue([hit(7, '勤奋')]);
		setUrl('/search?q=qin');
		render(Page, { context: ctx.context });
		await screen.findByRole('link', { name: '勤奋' });
		await new Promise((r) => setTimeout(r, 0));
		expect(getEntryMock).not.toHaveBeenCalled();
	});
});

	it('links the detail not-found state back to the current search URL (#104)', async () => {
		searchMock.mockResolvedValue([hit(7, '勤奋')]);
		getEntryMock.mockRejectedValue(new (await import('$lib/api/client')).ApiError(404, 'not found'));
		setUrl('/search?q=qin&kind=word&e=999');
		render(Page, { context: ctx.context });
		expect(await screen.findByRole('heading', { level: 2, name: 'Entry not found' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Back to search' }).getAttribute('href')).toBe(
			'/search?q=qin&kind=word'
		);
	});


describe('search page a11y names (#104)', () => {
	it('names every icon-only button and gives it a tooltip', async () => {
		render(Page, { context: ctx.context });
		const iconButtons = screen
			.getAllByRole('button')
			.filter((b) => (b.textContent ?? '').trim() === '');
		expect(iconButtons.length).toBeGreaterThan(0);
		for (const button of iconButtons) {
			expect(button.getAttribute('aria-label')).toBeTruthy();
			expect(button.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe(
				button.getAttribute('aria-label')
			);
		}
	});
});
