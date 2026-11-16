import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/frequency', () => ({ getFrequencyPacks: vi.fn(), getStarterEntries: vi.fn() }));

import { getFrequencyPacks, getStarterEntries } from '$lib/api/frequency';
import { clearStarterCache } from './starterDecks';
import StarterDecks from './StarterDecks.svelte';

const jiten = {
	id: 3,
	packId: 'jiten-frequency',
	name: 'Jiten frequency list',
	version: '1',
	language: 'ja',
	license: 'CC BY-SA 4.0',
	attribution: 'Jiten'
};
const entry = (id: number) => ({
	id,
	language: 'ja',
	kind: 'word',
	written: `w${id}`,
	readings: [],
	attrs: {},
	radicalId: null,
	rank: id
});

beforeEach(() => {
	clearStarterCache();
	vi.mocked(getFrequencyPacks).mockResolvedValue([jiten]);
	vi.mocked(getStarterEntries).mockResolvedValue({
		packId: 'jiten-frequency',
		name: 'Jiten frequency list',
		size: 2000,
		entries: [1, 2, 3, 4, 5].map(entry)
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('StarterDecks', () => {
	it('without a pack for the language: the hint, no group', async () => {
		render(StarterDecks, { language: 'zh', ownedEntryIds: new Set<number>() });
		await screen.findByText(
			'No frequency list is installed for Chinese. An administrator can add one in Settings, Data; see Data and licences.'
		);
		expect(screen.queryByRole('button', { name: /Starter decks/ })).toBeNull();
	});

	it('a collapsed group per pack with the licence line; expanding loads one size', async () => {
		render(StarterDecks, { language: 'ja', ownedEntryIds: new Set([2]) });
		const toggle = await screen.findByRole('button', {
			name: /Starter decks · Jiten frequency list/
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(screen.getByText('From Jiten frequency list · CC BY-SA 4.0')).toBeTruthy();
		expect(getStarterEntries).not.toHaveBeenCalled();
		await fireEvent.click(toggle);
		const links = screen.getAllByRole('link', { name: /^Top / });
		expect(links.map((a) => a.textContent)).toEqual(['Top 500', 'Top 1000', 'Top 2000']);
		expect(links[0].getAttribute('href')).toBe(
			'/flashcards/system/frequency/jiten-frequency/500'
		);
		await waitFor(() => expect(screen.getAllByText('1 of 5 in your decks')).toHaveLength(3));
		expect(getStarterEntries).toHaveBeenCalledTimes(1);
		expect(getStarterEntries).toHaveBeenCalledWith(3, 2000);
	});
});
