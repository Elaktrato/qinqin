import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn() }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	loadStudyHistory: vi.fn(async () => ({ decks: [], cards: [], reviews: [], merged: 0 }))
}));
import FlashcardsPage from './FlashcardsPage.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

beforeEach(() =>
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	})
);
afterEach(cleanup);

describe('FlashcardsPage shell', () => {
	it('renders the Decks heading inside the shared page column', () => {
		const { container } = render(FlashcardsPage, { props: { rest: '' }, context: ctx.context });
		expect(screen.getByRole('heading', { level: 1, name: 'Decks' })).toBeTruthy();
		expect(container.querySelector('.page-body')?.contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
	});

	it('routes system decks and settings', async () => {
		render(FlashcardsPage, { props: { rest: 'system/level/nope/x' }, context: ctx.context });
		expect(await screen.findByText('Deck not found.')).toBeTruthy();
	});

	it('renders the deck view for deck/general', async () => {
		render(FlashcardsPage, { props: { rest: 'deck/general' }, context: ctx.context });
		expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeTruthy();
	});
});
