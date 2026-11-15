import { cleanup, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn(() => Promise.resolve([]))
}));
vi.mock('$lib/events', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/events')>()),
	recordSessionOnce: vi.fn(),
	record: vi.fn()
}));
vi.mock('$lib/study/events', () => ({ startReviewOutbox: vi.fn() }));
vi.mock('$lib/workspaceGone', () => ({ watchDeletedWorkspaces: vi.fn() }));

import { goto } from '$app/navigation';
import { fireEvent } from '@testing-library/svelte';
import { recordSessionOnce } from '$lib/events';
import { select, workspaces } from '$lib/workspaces';
import { api } from '$lib/api/client';
import { auth } from '$lib/auth';
import { setUrl } from '$lib/testing/appState.svelte';
import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>page body</p>' }));

function mountAt(path: string, token: string | null) {
	setUrl(path);
	localStorage.clear();
	if (token) localStorage.setItem('qinqin.token', token);
	vi.mocked(api).mockImplementation((async (url: string) => {
		if (url === '/api/auth/me') return { id: 1, username: 'u', admin: false };
		return [];
	}) as never);
	return render(Layout, { children });
}

beforeEach(() => {
	auth.set({ token: null, user: null });
	workspaces.set({ list: [], current: null });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('layout auth guard', () => {
	it('sends a signed-out visitor from a private page to /login without rendering it', async () => {
		const { queryByText } = mountAt('/search', null);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login', { replaceState: true }));
		expect(queryByText('page body')).toBeNull();
	});

	it('sends a signed-in user from /login home', async () => {
		const { queryByText } = mountAt('/login', 'tok');
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/', { replaceState: true }));
		expect(queryByText('page body')).toBeNull();
	});

	it('renders a private page for a signed-in user and does not redirect', async () => {
		const { findByText } = mountAt('/search', 'tok');
		await findByText('page body');
		expect(goto).not.toHaveBeenCalled();
	});

	it('leaves the open Sources page alone when signed out', async () => {
		const { findByText } = mountAt('/sources', null);
		await findByText('page body');
		expect(goto).not.toHaveBeenCalled();
	});

	it('guards again when the token disappears (logout or expiry)', async () => {
		const { findByText, queryByText } = mountAt('/search', 'tok');
		await findByText('page body');
		auth.set({ token: null, user: null });
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login', { replaceState: true }));
		await waitFor(() => expect(queryByText('page body')).toBeNull());
	});
});

describe('layout workspaces', () => {
	const ws = (id: number) => ({ id, language: 'zh', name: `w${id}`, settings: {}, updatedAt: '' });

	it('offers Try again after a failed workspaces load and recovers', async () => {
		let fail = true;
		setUrl('/search');
		localStorage.clear();
		localStorage.setItem('qinqin.token', 'tok');
		vi.mocked(api).mockImplementation((async (url: string) => {
			if (url === '/api/auth/me') return { id: 1, username: 'u', admin: false };
			if (url === '/api/workspaces') {
				if (fail) throw new Error('offline');
				return [ws(1)];
			}
			return [];
		}) as never);
		const view = render(Layout, { children });
		await view.findByText('offline');
		fail = false;
		await fireEvent.click(view.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(view.queryByText('offline')).toBeNull());
		await waitFor(() => expect(get(workspaces).current?.id).toBe(1));
	});

	it('records a session for a workspace selected mid-session', async () => {
		setUrl('/search');
		localStorage.clear();
		localStorage.setItem('qinqin.token', 'tok');
		vi.mocked(api).mockImplementation((async (url: string) => {
			if (url === '/api/auth/me') return { id: 1, username: 'u', admin: false };
			if (url === '/api/workspaces') return [ws(1), ws(2)];
			return [];
		}) as never);
		render(Layout, { children });
		await waitFor(() => expect(recordSessionOnce).toHaveBeenCalledWith(1));
		select(2);
		await waitFor(() => expect(recordSessionOnce).toHaveBeenCalledWith(2));
	});
});
