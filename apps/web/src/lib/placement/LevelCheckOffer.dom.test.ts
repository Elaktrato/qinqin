import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';

vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	getStudyData: vi.fn()
}));

import { getSchemes } from '$lib/api/schemes';
import { getStudyData } from '$lib/studycore/data';
import LevelCheckOffer from './LevelCheckOffer.svelte';

const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }) as never);

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
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: cards(25) });
});
afterEach(() => cleanup());

describe('LevelCheckOffer', () => {
	it('is offered to a learner who has started, labelled experimental, and links to the check', async () => {
		render(LevelCheckOffer, { context: ctx.context });
		const offer = await screen.findByTestId('level-check-offer');
		expect(offer.textContent).toContain('Experimental');
		expect(offer.querySelector('a')?.getAttribute('href')).toBe('/settings?tab=study#level-check');
	});

	it('Not now hides it and is remembered', async () => {
		const first = render(LevelCheckOffer, { context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
		expect(screen.queryByTestId('level-check-offer')).toBeNull();
		first.unmount();
		render(LevelCheckOffer, { context: ctx.context });
		await waitFor(() => expect(getStudyData).toHaveBeenCalledTimes(2));
		await new Promise((r) => setTimeout(r, 10));
		expect(screen.queryByTestId('level-check-offer')).toBeNull();
	});

	it('is quiet on a fresh workspace and without a level list', async () => {
		vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] });
		render(LevelCheckOffer, { context: ctx.context });
		await waitFor(() => expect(getStudyData).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 10));
		expect(screen.queryByTestId('level-check-offer')).toBeNull();
		cleanup();
		vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: cards(25) });
		vi.mocked(getSchemes).mockResolvedValue([]);
		render(LevelCheckOffer, { context: ctx.context });
		await new Promise((r) => setTimeout(r, 10));
		expect(screen.queryByTestId('level-check-offer')).toBeNull();
	});

	it('is quiet when the requests fail', async () => {
		vi.mocked(getSchemes).mockRejectedValue(new Error('offline'));
		render(LevelCheckOffer, { context: ctx.context });
		await new Promise((r) => setTimeout(r, 10));
		expect(screen.queryByTestId('level-check-offer')).toBeNull();
	});
});
