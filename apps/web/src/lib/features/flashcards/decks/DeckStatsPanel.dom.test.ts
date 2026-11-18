import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeckNumbers } from './deckStats';
import DeckStatsPanel from './DeckStatsPanel.svelte';

const NUMBERS: DeckNumbers = {
	words: 20,
	cards: 24,
	due: 3,
	fresh: 2,
	states: { new: 4, learning: 2, young: 6, mature: 8, total: 20 },
	studied: 16,
	mastered: 8,
	reviews30: 42,
	retention: 0.9,
	retentionBase: 20
};

afterEach(() => cleanup());

describe('DeckStatsPanel', () => {
	it('names the 30-day figure "Recall, last 30 days"', () => {
		render(DeckStatsPanel, { numbers: NUMBERS });
		expect(screen.getByText('Recall, last 30 days')).toBeTruthy();
		expect(screen.queryByText('Retention (30 days)')).toBeNull();
	});

	it('keeps the below-the-floor hint', () => {
		render(DeckStatsPanel, { numbers: { ...NUMBERS, retention: null, retentionBase: 9 } });
		expect(screen.getByTitle('Shown after 10 repeat reviews')).toBeTruthy();
	});
});
