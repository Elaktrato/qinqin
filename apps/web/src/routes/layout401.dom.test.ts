import { EventLog } from '$lib/events';
import type { MockInstance } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));

import { goto } from '$app/navigation';
import { api } from '$lib/api/client';
import { createAppContext, type AppContext } from '$lib/context/app.svelte';
import { contextOf } from '$lib/context/context';
import { fakeDeps } from '$lib/testing/context';
import { setUrl } from '$lib/testing/appState.svelte';
import Layout from './+layout.svelte';

// The session's event log (record 0009): its methods, faked on the class.
beforeEach(() => {
	vi.spyOn(EventLog.prototype, 'record').mockImplementation((async () => {}) as never);
	vi.spyOn(EventLog.prototype, 'recordSessionOnce').mockImplementation((() => {}) as never);
});

/** The app context the layout mounts with (a fresh one per mount, as a page load). */
let app: AppContext;
function freshApp(): Map<unknown, unknown> {
	app = createAppContext(fakeDeps(undefined, { local: () => localStorage, window }));
	return contextOf(app);
}

const children = createRawSnippet(() => ({ render: () => '<p>page body</p>' }));
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ws = { id: 4, language: 'zh', name: 'w', settings: {}, updatedAt: '' };

beforeEach(() => {
	localStorage.clear();
	localStorage.setItem('qinqin.token', 'tok');
	localStorage.setItem('qinqin.workspace', '4');
	setUrl('/search');
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url === '/api/auth/me') return json({ id: 1, username: 'u', admin: false });
			if (url === '/api/workspaces') return json([ws]);
			if (url === '/api/expired') return new Response('unauthorized', { status: 401 });
			return json([]);
		})
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('layout with the real api client', () => {
	it('a mid-session 401 clears the store, the guard redirects, the workspace choice stays', async () => {
		const { findByText } = render(Layout, { props: { children }, context: freshApp() });
		await findByText('page body');
		await expect(api('/api/expired')).rejects.toMatchObject({ status: 401 });
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login', { replaceState: true }));
		expect(localStorage.getItem('qinqin.token')).toBeNull();
		expect(localStorage.getItem('qinqin.workspace')).toBe('4');
		expect(goto).toHaveBeenCalledTimes(1);
	});
});
