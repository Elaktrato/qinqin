import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '$lib/api/types';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/search', () => ({ search: vi.fn() }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(() => Promise.resolve([])) }));
vi.mock('$lib/events', () => ({ record: vi.fn() }));

import { goto } from '$app/navigation';
import { search } from '$lib/api/search';
import { setUrl } from '$lib/testing/appState.svelte';
import { workspaces } from '$lib/workspaces';
import Page from './+page.svelte';

const searchMock = vi.mocked(search);

function hit(id: number, written: string): SearchHit {
	return { id, written, readings: [], source: 'written' } as unknown as SearchHit;
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
	workspaces.set({
		list: [],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('search page', () => {
	it('mirrors the URL query into the input and searches it', async () => {
		searchMock.mockResolvedValue([hit(1, '你好')]);
		setUrl('/search?q=nihao');
		render(Page);
		const input = screen.getByLabelText('Search entries') as HTMLInputElement;
		await waitFor(() => expect(input.value).toBe('nihao'));
		expect(searchMock).toHaveBeenCalledWith('zh', 'nihao', expect.anything());
		expect(await screen.findByText('你好')).toBeTruthy();
	});

	it('submitting navigates to the trimmed query', async () => {
		render(Page);
		const input = screen.getByLabelText('Search entries');
		await fireEvent.input(input, { target: { value: '  ni  ' } });
		await fireEvent.submit(input.closest('form')!);
		expect(vi.mocked(goto).mock.calls[0][0]).toBe('/search?q=ni');
	});

	it('ignores a stale response that resolves after a newer search', async () => {
		const first = deferred<SearchHit[]>();
		const second = deferred<SearchHit[]>();
		searchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		setUrl('/search?q=a');
		render(Page);
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
		render(Page);
		const status = await screen.findByRole('status');
		await waitFor(() => expect(status.textContent).toBe('2 results for “x”.'));
		expect(status.getAttribute('aria-live')).toBe('polite');
	});

	it('announces an empty result and a single result', async () => {
		searchMock.mockResolvedValueOnce([hit(1, 'a')]);
		setUrl('/search?q=x');
		render(Page);
		const status = await screen.findByRole('status');
		await waitFor(() => expect(status.textContent).toBe('1 result for “x”.'));
		searchMock.mockResolvedValueOnce([]);
		setUrl('/search?q=y');
		await waitFor(() => expect(status.textContent).toBe('No results for “y”.'));
	});
});
