import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	addCard: vi.fn(async () => ({}))
}));
vi.mock('$lib/study/studyData', () => ({
	getStudyData: vi.fn(async () => ({ decks: [], cards: [] })),
	hasCard: vi.fn(() => false)
}));

import { workspaces } from '$lib/workspaces';
import { addCard } from '$lib/study/store';
import AddToStudy from './AddToStudy.svelte';

beforeEach(() => {
	workspaces.set({
		list: [{ id: 1, language: 'ja', name: 'ja' } as never],
		current: { id: 1, language: 'ja', name: 'ja' } as never
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('AddToStudy', () => {
	it('adds a character with the entryKind snapshot and no sentence', async () => {
		render(AddToStudy, { entryId: 11, written: '学', sentenceId: 5, kind: 'character' });
		const button = await screen.findByRole('button', { name: /Add to study/ });
		await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(button);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, opts] = vi.mocked(addCard).mock.calls[0] as unknown as [number, Record<string, unknown>];
		expect(opts.entryKind).toBe('character');
		expect(opts.sentenceId).toBeUndefined();
		expect(opts.written).toBe('学');
	});

	it('adds a word as before', async () => {
		render(AddToStudy, { entryId: 12, written: '学校', sentenceId: 5, kind: 'word' });
		const button = await screen.findByRole('button', { name: /Add to study/ });
		await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(button);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, opts] = vi.mocked(addCard).mock.calls[0] as unknown as [number, Record<string, unknown>];
		expect(opts.entryKind).toBeUndefined();
		expect(opts.sentenceId).toBe(5);
	});
});
