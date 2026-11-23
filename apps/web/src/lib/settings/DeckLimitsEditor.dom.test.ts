import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/studyData', () => ({ getStudyData: vi.fn() }));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	saveDeckLimits: vi.fn(() => Promise.resolve())
}));

import { saveDeckLimits } from '$lib/study/store';
import { getStudyData } from '$lib/study/studyData';
import { workspaces } from '$lib/workspaces';
import DeckLimitsEditor from './DeckLimitsEditor.svelte';

function setup(limits?: { workspace: object | null; decks: Record<string, object> }) {
	workspaces.set({ list: [], current: { id: 1, language: 'zh', name: 'zh' } as never });
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [], ...(limits ? { limits: limits as never } : {}) });
	return render(DeckLimitsEditor, { deckId: 'd1', deckName: 'HSK 1' });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('DeckLimitsEditor', () => {
	it('offers the workspace value and keeps it as the default choice', async () => {
		setup({ workspace: { new: 12 }, decks: {} });
		expect(await screen.findAllByLabelText('Use workspace limit (12)')).toHaveLength(1);
		expect(screen.getAllByLabelText('Use workspace limit (200)')).toHaveLength(1);
	});

	it('writes unlimited reviews as limits:deck with reviews null and no new field', async () => {
		setup();
		const unlimited = await screen.findAllByLabelText('Unlimited');
		await fireEvent.click(unlimited[1]);
		await fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
		await waitFor(() => expect(saveDeckLimits).toHaveBeenCalledTimes(1));
		expect(saveDeckLimits).toHaveBeenCalledWith(1, 'd1', { reviews: null });
	});

	it('writes an own value', async () => {
		setup({ workspace: null, decks: { d1: { new: 5 } } });
		const input = (await screen.findByLabelText('New cards per day value')) as HTMLInputElement;
		expect(input.value).toBe('5');
		await fireEvent.input(input, { target: { value: '8' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
		await waitFor(() => expect(saveDeckLimits).toHaveBeenCalledWith(1, 'd1', { new: 8 }));
	});

	it('saves to the workspace its limits were loaded from, not one selected since (#174)', async () => {
		setup({ workspace: null, decks: { d1: { new: 5 } } });
		const input = (await screen.findByLabelText('New cards per day value')) as HTMLInputElement;
		await waitFor(() => expect(input.value).toBe('5'));
		workspaces.set({ list: [], current: { id: 2, language: 'ja', name: 'ja' } as never });
		await fireEvent.input(input, { target: { value: '8' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
		await waitFor(() => expect(saveDeckLimits).toHaveBeenCalledWith(1, 'd1', { new: 8 }));
	});

	it('refuses an invalid value without writing', async () => {
		setup({ workspace: null, decks: { d1: { new: 5 } } });
		const input = await screen.findByLabelText('New cards per day value');
		await fireEvent.input(input, { target: { value: '2.5' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Enter a whole number from 0 to 9999.');
		expect(saveDeckLimits).not.toHaveBeenCalled();
	});
});
