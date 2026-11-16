import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
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
		at('flashcards', 'deck/general/settings');
		render(Page);
		expect(document.title).toBe('Plugin · qinqin');
		pluginStates.set({ list: [], status: 'ready' });
		await waitFor(() => expect(document.title).toBe('Deck settings · Flashcards · qinqin'));
		// A later refresh of the states must not put the dispatcher's title back.
		pluginStates.set({ list: [], status: 'ready' });
		await new Promise((r) => setTimeout(r, 0));
		expect(document.title).toBe('Deck settings · Flashcards · qinqin');
	});

	it('says Plugin for an unknown plugin', async () => {
		pluginStates.set({ list: [], status: 'ready' });
		at('nope', '');
		render(Page);
		await waitFor(() => expect(document.title).toBe('Plugin · qinqin'));
	});
});
