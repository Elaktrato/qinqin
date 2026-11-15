import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn() }));

import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import type { EntryBase, Scheme } from '$lib/api/types';
import { clearLevelItemsCache } from './systemDeckItems';
import SystemDecks from './SystemDecks.svelte';

const SCHEMES: Scheme[] = [
	{
		id: 1,
		name: 'HSK words',
		unit: 'word',
		language: 'zh',
		packId: 'hsk-words',
		levels: [
			{ id: 11, ord: 1, name: 'HSK 1' },
			{ id: 12, ord: 2, name: 'HSK 2' },
			{ id: 13, ord: 3, name: 'HSK 3' }
		]
	},
	{ id: 2, name: 'JLPT kanji', unit: 'character', language: 'ja', packId: 'jlpt-kanji', levels: [{ id: 21, ord: 1, name: 'N5' }] }
];

function entry(id: number): EntryBase {
	return { id, language: 'zh', kind: 'word', written: `w${id}`, readings: [], attrs: {}, radicalId: null };
}

let active = 0;
let maxActive = 0;

beforeEach(() => {
	clearLevelItemsCache();
	active = 0;
	maxActive = 0;
	vi.mocked(getSchemes).mockResolvedValue(SCHEMES);
	vi.mocked(getSchemeEntries).mockImplementation(async (_id, level) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		await new Promise((r) => setTimeout(r, 5));
		active -= 1;
		return level === 'HSK 1' ? [entry(1), entry(2)] : level === 'HSK 2' ? [entry(3)] : [entry(4), entry(5), entry(6)];
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('SystemDecks', () => {
	it('lists the schemes of the workspace language, collapsed, without loading levels', async () => {
		render(SystemDecks, { language: 'zh', ownedEntryIds: new Set([1]) });
		const toggle = await screen.findByRole('button', { name: /HSK words/ });
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByRole('button', { name: /JLPT/ })).toBeNull();
		expect(getSchemeEntries).not.toHaveBeenCalled();
	});

	it('expanding loads each level once, two at a time, and counts what is already yours', async () => {
		render(SystemDecks, { language: 'zh', ownedEntryIds: new Set([1, 3, 4]) });
		await fireEvent.click(await screen.findByRole('button', { name: /HSK words/ }));
		const level1 = (await screen.findByRole('link', { name: 'HSK 1' })).closest('li') as HTMLElement;
		await waitFor(() => expect(within(level1).getByText('1 of 2 in your decks')).toBeTruthy());
		const level2 = screen.getByRole('link', { name: 'HSK 2' }).closest('li') as HTMLElement;
		await waitFor(() => expect(within(level2).getByText('1 of 1 in your decks')).toBeTruthy());
		const level3 = screen.getByRole('link', { name: 'HSK 3' }).closest('li') as HTMLElement;
		await waitFor(() => expect(within(level3).getByText('1 of 3 in your decks')).toBeTruthy());
		expect(getSchemeEntries).toHaveBeenCalledTimes(3);
		expect(maxActive).toBeLessThanOrEqual(2);
		expect(screen.getByRole('link', { name: 'HSK 1' }).getAttribute('href')).toBe(
			'/p/flashcards/system/level/hsk-words/HSK%201'
		);
	});

	it('collapsing and expanding again does not load again', async () => {
		render(SystemDecks, { language: 'zh', ownedEntryIds: new Set<number>() });
		const toggle = await screen.findByRole('button', { name: /HSK words/ });
		await fireEvent.click(toggle);
		await screen.findByText('0 of 2 in your decks');
		await fireEvent.click(toggle);
		expect(screen.queryByRole('link', { name: 'HSK 1' })).toBeNull();
		await fireEvent.click(toggle);
		await screen.findByText('0 of 2 in your decks');
		expect(getSchemeEntries).toHaveBeenCalledTimes(3);
	});

	it('shows an error for a level that could not load', async () => {
		vi.mocked(getSchemeEntries).mockRejectedValue(new Error('offline'));
		render(SystemDecks, { language: 'zh', ownedEntryIds: new Set<number>() });
		await fireEvent.click(await screen.findByRole('button', { name: /HSK words/ }));
		expect((await screen.findAllByText('Could not load')).length).toBeGreaterThan(0);
	});

	it('says so when no level pack is installed for the language', async () => {
		render(SystemDecks, { language: 'ko', ownedEntryIds: new Set<number>() });
		expect(await screen.findByText(/No level decks/)).toBeTruthy();
	});

	it('has no edit controls', async () => {
		render(SystemDecks, { language: 'zh', ownedEntryIds: new Set<number>() });
		await fireEvent.click(await screen.findByRole('button', { name: /HSK words/ }));
		await screen.findByRole('link', { name: 'HSK 1' });
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.queryByRole('button', { name: /delete|rename|remove/i })).toBeNull();
	});
});
