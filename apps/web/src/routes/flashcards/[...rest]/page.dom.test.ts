import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn(async () => ({ decks: [], cards: [], reviews: [], merged: 0 }))
}));

import { page, setUrl } from '$lib/testing/appState.svelte';
import Page from './+page.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

afterEach(() => {
	cleanup();
	document.title = '';
	ctx.session.features.set({ list: [], status: 'idle' });
	ctx.session.workspaces.set({ list: [], current: null });
});

describe('/flashcards', () => {
	it('renders the flashcards views at the core route, with their titles', async () => {
		const ws = { id: 1, language: 'zh', name: 'zh' } as never;
		ctx.session.workspaces.set({ list: [ws], current: ws });
		ctx.session.features.set({ list: [], status: 'loading' });
		setUrl('/flashcards/deck/general/settings');
		(page as unknown as { params: Record<string, string> }).params = { rest: 'deck/general/settings' };
		render(Page, { context: ctx.context });
		expect(document.title).toBe('Decks · qinqin');
		ctx.session.features.set({ list: [], status: 'ready' });
		await waitFor(() => expect(document.title).toBe('Deck settings · Flashcards · qinqin'));
	});
});
