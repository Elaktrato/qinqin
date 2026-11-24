import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));

import { page, setUrl } from '$lib/testing/appState.svelte';
import Page from './+page.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

afterEach(() => {
	cleanup();
	document.title = '';
	ctx.session.plugins.set({ list: [], status: 'idle' });
});

describe('/reader', () => {
	it('says the reader is switched off for a user who switched it off', async () => {
		ctx.session.plugins.set({ list: [{ id: 'qinqin-reader', manifest: {}, enabled: false, order: 0 }], status: 'ready' });
		setUrl('/reader/book/3/0');
		(page as unknown as { params: Record<string, string> }).params = { rest: 'book/3/0' };
		render(Page, { context: ctx.context });
		expect(screen.getByRole('heading', { name: 'The reader is switched off' })).toBeTruthy();
		expect(document.title).toBe('Reader · qinqin');
		// #102: no rail and no rail button behind the notice.
		expect(screen.queryByRole('tablist')).toBeNull();
		expect(screen.queryByRole('button', { name: /Contents, bookmarks/ })).toBeNull();
	});
});
