import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';

vi.mock('$lib/api/starter', () => ({ starterSets: vi.fn(), starterSet: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	getStudyData: vi.fn()
}));
vi.mock('$lib/features/flashcards/decks/starterSet', () => ({
	addStarterSet: vi.fn(),
	starterSetTarget: (s: { language: string; name: string }) => ({ id: `d-starter-${s.language}`, name: s.name })
}));

import { starterSets } from '$lib/api/starter';
import { addStarterSet } from '$lib/features/flashcards/decks/starterSet';
import { getStudyData } from '$lib/studycore/data';
import StarterOffer from './StarterOffer.svelte';

let ctx: TestContext;
beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	ctx = testContext();
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'ja', name: 'ja', settings: {} } as never],
		current: { id: 1, language: 'ja', name: 'ja', settings: {} } as never
	});
	vi.spyOn(ctx.session.workspaces, 'setSettings').mockResolvedValue({} as never);
	vi.mocked(starterSets).mockResolvedValue([
		{ id: 'starter-ja', language: 'ja', name: 'Starter words (Japanese)', license: 'CC0-1.0', attribution: 'x', wordCount: 55, humanReviewed: false }
	]);
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] });
	vi.mocked(addStarterSet).mockResolvedValue({
		added: 55,
		known: 0,
		empty: false,
		plan: { deck: null, writes: [], created: 55, joined: 0, skipped: 0 }
	});
});
afterEach(() => cleanup());

describe('StarterOffer', () => {
	it('is offered on a fresh workspace', async () => {
		render(StarterOffer, { context: ctx.context });
		const offer = await screen.findByTestId('starter-offer');
		expect(offer.textContent).toContain('New to this language?');
		expect(screen.getByRole('button', { name: 'Start with Starter mode' })).toBeTruthy();
	});

	it('is quiet when the workspace already has a card', async () => {
		vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [{ id: 'c' } as never] });
		render(StarterOffer, { context: ctx.context });
		await waitFor(() => expect(getStudyData).toHaveBeenCalled());
		await Promise.resolve();
		expect(screen.queryByTestId('starter-offer')).toBeNull();
	});

	it('is quiet for a language without a set', async () => {
		vi.mocked(starterSets).mockResolvedValue([]);
		render(StarterOffer, { context: ctx.context });
		await waitFor(() => expect(starterSets).toHaveBeenCalled());
		await Promise.resolve();
		expect(screen.queryByTestId('starter-offer')).toBeNull();
	});

	it('Not now hides it and is remembered', async () => {
		const first = render(StarterOffer, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
		expect(screen.queryByTestId('starter-offer')).toBeNull();
		first.unmount();
		render(StarterOffer, { context: ctx.context });
		await waitFor(() => expect(getStudyData).toHaveBeenCalledTimes(2));
		await Promise.resolve();
		expect(screen.queryByTestId('starter-offer')).toBeNull();
	});

	it('adding the words turns Starter mode on and closes the offer', async () => {
		render(StarterOffer, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Start with Starter mode' }));
		await waitFor(() => expect(addStarterSet).toHaveBeenCalledWith(expect.anything(), 1, 'starter-ja', expect.anything()));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(1, { starter: { enabled: true } }));
		await waitFor(() => expect(screen.queryByTestId('starter-offer')).toBeNull());
	});
});
