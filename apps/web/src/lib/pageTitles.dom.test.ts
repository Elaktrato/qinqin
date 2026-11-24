import { EventLog } from '$lib/events';
import type { MockInstance } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/search', () => ({ search: vi.fn(() => Promise.resolve([])) }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(() => Promise.resolve([])) }));

import { setUrl } from '$lib/testing/appState.svelte';
import { testContext } from '$lib/testing/context';
import Login from '../routes/login/+page.svelte';
import Register from '../routes/register/+page.svelte';
import Search from '../routes/search/+page.svelte';
import Sources from '../routes/sources/+page.svelte';
import Settings from '../routes/settings/+page.svelte';
import Home from '../routes/+page.svelte';

// The session's event log (record 0009): its methods, faked on the class.
beforeEach(() => {
	vi.spyOn(EventLog.prototype, 'record').mockImplementation(((async () => {})) as never);
});

afterEach(() => {
	cleanup();
	document.title = '';
});

describe('per-route document titles', () => {
	for (const [name, component, title] of [
		['login', Login, 'Sign in · qinqin'],
		['register', Register, 'Create account · qinqin'],
		['search', Search, 'Search · qinqin'],
		['sources', Sources, 'Sources · qinqin'],
		['settings', Settings, 'Workspaces · Settings · qinqin'],
		['home', Home, 'qinqin']
	] as const) {
		it(`${name} sets "${title}"`, async () => {
			setUrl(`/${name}`);
			// Signed out for the sign-in pages, signed in for the others.
			const signedOut = name === 'login' || name === 'register';
			render(component as never, { context: testContext(signedOut ? { user: null } : {}).context });
			await waitFor(() => expect(document.title).toBe(title));
		});
	}
});
