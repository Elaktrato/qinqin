import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/frequency', () => ({ getFrequencyPacks: vi.fn(), getStarterEntries: vi.fn() }));
vi.mock('./addDeckFromOverview', () => ({ addDeckFromOverview: vi.fn() }));

import { getFrequencyPacks, getStarterEntries } from '$lib/api/frequency';
import { addDeckFromOverview } from './addDeckFromOverview';
import { clearStarterCache, starterTarget, starterDecks } from './starterDecks';
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
		expect(toggle.className).toContain('button');
		expect(toggle.className).toContain('secondary');
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

	it('Add copies the deck from the overview and says what it added', async () => {
		const onchanged = vi.fn();
		vi.mocked(addDeckFromOverview).mockResolvedValue({
			deck: null,
			writes: [],
			created: 5,
			joined: 0,
			skipped: 0,
			known: 2
		});
		render(StarterDecks, {
			language: 'ja',
			ownedEntryIds: new Set<number>(),
			workspaceId: 2,
			deckIds: new Set<string>(),
			knownIds: new Set([2, 3]),
			onchanged
		});
		await fireEvent.click(await screen.findByRole('button', { name: /Starter decks/ }));
		const add = (await screen.findAllByRole('button', { name: /^Add/ }))[0];
		await fireEvent.click(add);
		await waitFor(() => expect(addDeckFromOverview).toHaveBeenCalledOnce());
		const deck = starterDecks([jiten], 'ja').find((d) => d.size === 500)!;
		expect(addDeckFromOverview).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 2,
				exclude: new Set([2, 3]),
				target: starterTarget(deck),
				settings: { newOrder: { by: 'frequency' } }
			})
		);
		expect(onchanged).toHaveBeenCalled();
		expect(await screen.findByText(/Added 5 words; 2 you know were skipped/)).toBeTruthy();
	});

	it('an existing copy opens instead of offering Add', async () => {
		const deck = starterDecks([jiten], 'ja').find((d) => d.size === 500)!;
		render(StarterDecks, {
			language: 'ja',
			ownedEntryIds: new Set<number>(),
			workspaceId: 2,
			deckIds: new Set([starterTarget(deck).id])
		});
		await fireEvent.click(await screen.findByRole('button', { name: /Starter decks/ }));
		const row = (await screen.findByRole('link', { name: 'Top 500' })).closest('li')!;
		const open = within(row).getByRole('link', { name: /^Open my copy/ });
		expect(open.getAttribute('href')).toContain(starterTarget(deck).id);
		expect(within(row).queryByRole('button', { name: /^Add/ })).toBeNull();
	});
});
