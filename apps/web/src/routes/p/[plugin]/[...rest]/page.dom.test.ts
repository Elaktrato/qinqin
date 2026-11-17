import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
const { goto } = vi.hoisted(() => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn() }));
vi.mock('$lib/study/history', () => ({
	loadStudyHistory: vi.fn(async () => ({ decks: [], cards: [], reviews: [], merged: 0 }))
}));

import { page, setUrl } from '$lib/testing/appState.svelte';
import { pluginStates } from '$lib/plugins/states';
import { workspaces } from '$lib/workspaces';
import Page from './+page.svelte';

afterEach(() => {
	cleanup();
	vi.mocked(goto).mockClear();
	document.title = '';
	pluginStates.set({ list: [], status: 'idle' });
	workspaces.set({ list: [], current: null });
});

function at(plugin: string, rest: string): void {
	setUrl(`/p/${plugin}/${rest}`);
	(page as unknown as { params: Record<string, string> }).params = { plugin, rest };
}

describe('plugin page titles', () => {
	it('ends with the plugin view title once the plugins are known', async () => {
		const ws = { id: 1, language: 'zh', name: 'zh' } as never;
		workspaces.set({ list: [ws], current: ws });
		pluginStates.set({ list: [], status: 'loading' });
		at('journal', '');
		render(Page);
		expect(document.title).toBe('Plugin · qinqin');
		pluginStates.set({ list: [], status: 'ready' });
		await waitFor(() => expect(document.title).not.toBe('Plugin · qinqin'));
		const title = document.title;
		// A later refresh of the states must not put the dispatcher's title back.
		pluginStates.set({ list: [], status: 'ready' });
		await new Promise((r) => setTimeout(r, 0));
		expect(document.title).toBe(title);
	});

	it('sends the old core feature URLs to their core routes, keeping query and fragment', async () => {
		pluginStates.set({ list: [], status: 'ready' });
		setUrl('/p/flashcards/deck/general/settings?x=1#cards');
		(page as unknown as { params: Record<string, string> }).params = { plugin: 'flashcards', rest: 'deck/general/settings' };
		render(Page);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/flashcards/deck/general/settings?x=1#cards', { replaceState: true }));
		vi.mocked(goto).mockClear();
		cleanup();
		at('reader', 'book/2/1');
		render(Page);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/reader/book/2/1', { replaceState: true }));
	});

	it('still renders a plugin at /p/<slug>', async () => {
		const ws = { id: 1, language: 'zh', name: 'zh' } as never;
		workspaces.set({ list: [ws], current: ws });
		pluginStates.set({ list: [], status: 'ready' });
		at('grammar', '');
		render(Page);
		await waitFor(() => expect(document.title).not.toBe('Plugin · qinqin'));
		expect(goto).not.toHaveBeenCalled();
	});

	it('says Plugin for an unknown plugin', async () => {
		pluginStates.set({ list: [], status: 'ready' });
		at('nope', '');
		render(Page);
		await waitFor(() => expect(document.title).toBe('Plugin · qinqin'));
	});
});
