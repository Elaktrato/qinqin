import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn() }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
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

describe('/flashcards', () => {
	it('renders the flashcards views at the core route, with their titles', async () => {
		const ws = { id: 1, language: 'zh', name: 'zh' } as never;
		workspaces.set({ list: [ws], current: ws });
		pluginStates.set({ list: [], status: 'loading' });
		setUrl('/flashcards/deck/general/settings');
		(page as unknown as { params: Record<string, string> }).params = { rest: 'deck/general/settings' };
		render(Page);
		expect(document.title).toBe('Decks · qinqin');
		pluginStates.set({ list: [], status: 'ready' });
		await waitFor(() => expect(document.title).toBe('Deck settings · Flashcards · qinqin'));
	});
});
