import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/search', () => ({ search: vi.fn(() => Promise.resolve([])) }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(() => Promise.resolve([])) }));
vi.mock('$lib/events', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/events')>()),
	record: vi.fn()
}));

import { setUrl } from '$lib/testing/appState.svelte';
import Login from '../routes/login/+page.svelte';
import Register from '../routes/register/+page.svelte';
import Search from '../routes/search/+page.svelte';
import Sources from '../routes/sources/+page.svelte';
import Settings from '../routes/settings/+page.svelte';
import Home from '../routes/+page.svelte';

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
			render(component as never);
			await waitFor(() => expect(document.title).toBe(title));
		});
	}
});
