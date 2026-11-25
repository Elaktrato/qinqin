import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';

vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn() }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	getStudyData: vi.fn()
}));

import { getSchemes } from '$lib/api/schemes';
import { getStudyData } from '$lib/study/data';
import PlacementOffer from './PlacementOffer.svelte';

let ctx: TestContext;
beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	ctx = testContext();
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
	vi.mocked(getSchemes).mockResolvedValue([
		{ id: 9, name: 'HSK', unit: 'word', language: 'zh', packId: 'hsk-words', levels: [{ id: 1, ord: 1, name: 'HSK 1' }] }
	]);
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] });
});
afterEach(() => cleanup());

describe('PlacementOffer', () => {
	it('is offered on a fresh workspace and links to Settings', async () => {
		render(PlacementOffer, { context: ctx.context });
		const offer = await screen.findByTestId('placement-offer');
		expect(offer.querySelector('a')?.getAttribute('href')).toBe('/settings?tab=study#known');
	});

	it('Not now hides it and is remembered', async () => {
		const first = render(PlacementOffer, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
		expect(screen.queryByTestId('placement-offer')).toBeNull();
		first.unmount();
		render(PlacementOffer, { context: ctx.context });
		await waitFor(() => expect(getStudyData).toHaveBeenCalledTimes(2));
		expect(screen.queryByTestId('placement-offer')).toBeNull();
	});

	it('is not offered once the workspace has a card or a mark, or without a level list', async () => {
		vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [], known: [3] });
		render(PlacementOffer, { context: ctx.context });
		await waitFor(() => expect(getStudyData).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 10));
		expect(screen.queryByTestId('placement-offer')).toBeNull();
		cleanup();
		vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] });
		vi.mocked(getSchemes).mockResolvedValue([]);
		render(PlacementOffer, { context: ctx.context });
		await new Promise((r) => setTimeout(r, 10));
		expect(screen.queryByTestId('placement-offer')).toBeNull();
	});
});
