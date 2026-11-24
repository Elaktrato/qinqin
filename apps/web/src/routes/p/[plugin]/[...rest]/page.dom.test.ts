import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
const { goto } = vi.hoisted(() => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn() }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	loadStudyHistory: vi.fn(async () => ({ decks: [], cards: [], reviews: [], merged: 0 }))
}));

import { page, setUrl } from '$lib/testing/appState.svelte';
import Page from './+page.svelte';
import source from './+page.svelte?raw';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

afterEach(() => {
	cleanup();
	vi.mocked(goto).mockClear();
	document.title = '';
	ctx.session.plugins.set({ list: [], status: 'idle' });
	ctx.session.workspaces.set({ list: [], current: null });
});

function at(plugin: string, rest: string): void {
	setUrl(`/p/${plugin}/${rest}`);
	(page as unknown as { params: Record<string, string> }).params = { plugin, rest };
}

describe('the plugin shell notices in the lighter look (#106)', () => {
	it('the loading, error and unavailable states are muted plain text', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/\.notice\s*\{[^}]*color:\s*var\(--readable-muted\)/);
		expect(css).toMatch(/\.notice\[role='alert'\]\s*\{[^}]*color:\s*var\(--readable-bad\)/);
	});
});

describe('plugin page titles', () => {
	it('ends with the plugin view title once the plugins are known', async () => {
		const ws = { id: 1, language: 'zh', name: 'zh' } as never;
		ctx.session.workspaces.set({ list: [ws], current: ws });
		ctx.session.plugins.set({ list: [], status: 'loading' });
		at('journal', '');
		render(Page, { context: ctx.context });
		expect(document.title).toBe('Plugin · qinqin');
		ctx.session.plugins.set({ list: [], status: 'ready' });
		await waitFor(() => expect(document.title).not.toBe('Plugin · qinqin'));
		const title = document.title;
		// A later refresh of the states must not put the dispatcher's title back.
		ctx.session.plugins.set({ list: [], status: 'ready' });
		await new Promise((r) => setTimeout(r, 0));
		expect(document.title).toBe(title);
	});

	it('sends the old core feature URLs to their core routes, keeping query and fragment', async () => {
		ctx.session.plugins.set({ list: [], status: 'ready' });
		setUrl('/p/flashcards/deck/general/settings?x=1#cards');
		(page as unknown as { params: Record<string, string> }).params = { plugin: 'flashcards', rest: 'deck/general/settings' };
		render(Page, { context: ctx.context });
		// the notice never flashes before the redirect (#106, prep item R1)
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.queryByText('Plugin not available.')).toBeNull();
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/flashcards/deck/general/settings?x=1#cards', { replaceState: true }));
		vi.mocked(goto).mockClear();
		cleanup();
		at('reader', 'book/2/1');
		render(Page, { context: ctx.context });
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/reader/book/2/1', { replaceState: true }));
	});

	it('still renders a plugin at /p/<slug>', async () => {
		const ws = { id: 1, language: 'zh', name: 'zh' } as never;
		ctx.session.workspaces.set({ list: [ws], current: ws });
		ctx.session.plugins.set({ list: [], status: 'ready' });
		at('grammar', '');
		render(Page, { context: ctx.context });
		await waitFor(() => expect(document.title).not.toBe('Plugin · qinqin'));
		expect(goto).not.toHaveBeenCalled();
	});

	it('says Plugin for an unknown plugin', async () => {
		ctx.session.plugins.set({ list: [], status: 'ready' });
		at('nope', '');
		render(Page, { context: ctx.context });
		await waitFor(() => expect(document.title).toBe('Plugin · qinqin'));
	});
});
