import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn(async () => ({ decks: [], cards: [], reviews: [], merged: 0 })) }));
import FlashcardsPage from './FlashcardsPage.svelte';

afterEach(cleanup);

describe('FlashcardsPage shell', () => {
	it('renders the Decks heading for the empty rest', () => {
		render(FlashcardsPage, { rest: '' });
		expect(screen.getByRole('heading', { level: 1, name: 'Decks' })).toBeTruthy();
	});

	it('renders the deck view for deck/general', () => {
		render(FlashcardsPage, { rest: 'deck/general' });
		expect(screen.getByTestId('view-deck')).toBeTruthy();
	});
});
