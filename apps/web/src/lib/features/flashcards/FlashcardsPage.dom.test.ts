import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn() }));
vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn(async () => ({ decks: [], cards: [], reviews: [], merged: 0 })) }));
import { workspaces } from '$lib/workspaces';
import FlashcardsPage from './FlashcardsPage.svelte';

beforeEach(() =>
	workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	})
);
afterEach(cleanup);

describe('FlashcardsPage shell', () => {
	it('renders the Decks heading inside the shared page column', () => {
		const { container } = render(FlashcardsPage, { rest: '' });
		expect(screen.getByRole('heading', { level: 1, name: 'Decks' })).toBeTruthy();
		expect(container.querySelector('.page-body')?.contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
	});

	it('routes system decks and settings', async () => {
		render(FlashcardsPage, { rest: 'system/level/nope/x' });
		expect(await screen.findByText('Deck not found.')).toBeTruthy();
	});

	it('renders the deck view for deck/general', async () => {
		render(FlashcardsPage, { rest: 'deck/general' });
		expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeTruthy();
	});
});
