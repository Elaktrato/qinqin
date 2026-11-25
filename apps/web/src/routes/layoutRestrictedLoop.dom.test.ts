import { EventLog } from '$lib/events';
import type { MockInstance } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()), afterNavigate: vi.fn() }));

import { goto } from '$app/navigation';
import { api } from '$lib/api/client';
import { createAppContext, type AppContext } from '$lib/context/app.svelte';
import { contextOf } from '$lib/context/context';
import { fakeDeps } from '$lib/testing/context';
import { setUrl } from '$lib/testing/appState.svelte';
import Layout from './+layout.svelte';

// The session's event log (record 0009): its methods, faked on the class.
beforeEach(() => {
	vi.spyOn(EventLog.prototype, 'record').mockImplementation(((async () => {})) as never);
	vi.spyOn(EventLog.prototype, 'recordSessionWhenSettled').mockImplementation(((async () => {})) as never);
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
const restrictedMe = {
	id: 1,
	username: 'u',
	admin: false,
	email: null,
	emailVerified: false,
	mustChangePassword: true,
	createdAt: 't',
	restriction: 'password_change'
};
const fullMe = { ...restrictedMe, mustChangePassword: false, restriction: '' };

let urls: string[];
let meBody: typeof restrictedMe;
const count = (prefix: string) => urls.filter((u) => u.startsWith(prefix)).length;
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeEach(() => {
	urls = [];
	meBody = restrictedMe;
	localStorage.clear();
	localStorage.setItem('qinqin.token', 'tok');
	setUrl('/account/password');
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			urls.push(url);
			// A macrotask per answer, so a request loop cannot starve the timers.
			await new Promise((r) => setTimeout(r, 1));
			if (url === '/api/auth/me') return json(meBody);
			if (url === '/api/account/password') return json({});
			return json({ error: 'password_change_required' }, 403);
		})
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('layout with a restricted session and the real api client', () => {
	it('does not loop on 403s: bounded requests, no alert banner', async () => {
		const { container, findByText } = render(Layout, { props: { children }, context: freshApp() });
		await findByText('page body');
		let sawAlert = false;
		const watch = new MutationObserver(() => {
			if (container.querySelector('.workspace-error, [role="alert"]')) sawAlert = true;
		});
		watch.observe(document.body, { childList: true, subtree: true });
		await settle();
		watch.disconnect();
		expect(count('/api/me/time-zone')).toBeLessThanOrEqual(1);
		expect(count('/api/workspaces')).toBe(0);
		expect(count('/api/features')).toBe(0);
		expect(count('/api/auth/me')).toBeLessThanOrEqual(2);
		expect(sawAlert).toBe(false);
		expect(container.querySelector('.workspace-error')).toBeNull();
	});

	it('a session that turns restricted mid-use is still moved to /account/password', async () => {
		meBody = fullMe;
		setUrl('/search');
		const { findByText } = render(Layout, { props: { children }, context: freshApp() });
		await findByText('page body');
		meBody = restrictedMe;
		await expect(api('/api/something')).rejects.toMatchObject({ status: 403 });
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/account/password', { replaceState: true }));
	});
});
