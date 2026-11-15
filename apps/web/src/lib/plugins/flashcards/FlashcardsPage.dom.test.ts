import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
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
