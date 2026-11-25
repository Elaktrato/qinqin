import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/commands/cards', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/commands/cards')>()),
	addCard: vi.fn(async () => ({}))
}));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	getStudyData: vi.fn(async () => ({ decks: [], cards: [] })),
	hasCard: vi.fn(() => false)
}));

import { addCard } from '$lib/study/commands/cards';
import { getStudyData, hasCard } from '$lib/study/data';
import AddToStudy from './AddToStudy.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

beforeEach(() => {
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'ja', name: 'ja' } as never],
		current: { id: 1, language: 'ja', name: 'ja' } as never
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('AddToStudy', () => {
	it('adds to the workspace the in-deck check ran against, even when another was selected in the same moment (#174)', async () => {
		render(AddToStudy, { props: { entryId: 11, written: '学', sentenceId: 5 }, context: ctx.context });
		const button = (await screen.findByRole('button', { name: /Add to deck/ })) as HTMLButtonElement;
		await waitFor(() => expect(button.disabled).toBe(false));
		ctx.session.workspaces.set({ list: [], current: { id: 2, language: 'ja', name: 'ja2' } as never });
		button.click();
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		expect(vi.mocked(addCard).mock.calls[0][1]).toBe(1);
	});

	it('adds a character with the entryKind snapshot and no sentence', async () => {
		render(AddToStudy, { props: { entryId: 11, written: '学', sentenceId: 5, kind: 'character' }, context: ctx.context });
		const button = await screen.findByRole('button', { name: /Add to deck/ });
		await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(button);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, ws, , opts] = vi.mocked(addCard).mock.calls[0] as unknown as [unknown, number, number, Record<string, unknown>];
		expect(ws).toBe(1);
		expect(opts.entryKind).toBe('character');
		expect(opts.sentenceId).toBeUndefined();
		expect(opts.written).toBe('学');
	});

	it('adds a word as before', async () => {
		render(AddToStudy, { props: { entryId: 12, written: '学校', sentenceId: 5, kind: 'word' }, context: ctx.context });
		const button = await screen.findByRole('button', { name: /Add to deck/ });
		await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(button);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, ws, , opts] = vi.mocked(addCard).mock.calls[0] as unknown as [unknown, number, number, Record<string, unknown>];
		expect(ws).toBe(1);
		expect(opts.entryKind).toBeUndefined();
		expect(opts.sentenceId).toBe(5);
	});
});


describe('AddToStudy in the entry header (#104)', () => {
	const deck = (id: string, name: string) =>
		({ id, name, createdAt: '2026-01-01T00:00:00Z' }) as never;

	it('Add to deck is the one primary button and adds to General in one click', async () => {
		render(AddToStudy, { props: { entryId: 11, written: '学', kind: 'character' }, context: ctx.context });
		const add = await screen.findByRole('button', { name: 'Add to deck' });
		await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
		expect(add.className).toContain('primary');
		await fireEvent.click(add);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, ws, , opts] = vi.mocked(addCard).mock.calls[0] as unknown as [unknown, number, number, Record<string, unknown>];
		expect(ws).toBe(1);
		expect(opts.deckIds).toEqual([expect.stringMatching(/general/i)]);
	});

	it('Choose a deck opens a Menu, Escape returns focus, choosing a deck adds there', async () => {
		vi.mocked(getStudyData).mockResolvedValueOnce({
			decks: [deck('deck-1', 'History')],
			cards: []
		} as never);
		render(AddToStudy, { props: { entryId: 11, written: '学', kind: 'character' }, context: ctx.context });
		const choose = await screen.findByRole('button', { name: 'Choose a deck' });
		await waitFor(() => expect((screen.getByRole('button', { name: 'Add to deck' }) as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(choose);
		const menu = await screen.findByRole('menu', { name: 'Deck' });
		await fireEvent.keyDown(menu, { key: 'Escape' });
		expect(document.activeElement).toBe(choose);
		await fireEvent.click(choose);
		await fireEvent.click(await screen.findByRole('menuitem', { name: 'History' }));
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, ws, , opts] = vi.mocked(addCard).mock.calls[0] as unknown as [unknown, number, number, Record<string, unknown>];
		expect(ws).toBe(1);
		expect(opts.deckIds).toEqual(['deck-1']);
	});

	it('shows the in-study chip with a check instead of the button when the entry has a card', async () => {
		vi.mocked(hasCard).mockReturnValueOnce(true);
		render(AddToStudy, { props: { entryId: 11, written: '学', kind: 'character' }, context: ctx.context });
		const chip = await screen.findByText('In study deck');
		expect(chip.closest('.chip')?.textContent).toContain('In study deck');
		expect(screen.queryByRole('button', { name: 'Add to deck' })).toBeNull();
	});
});
