import { testContext, type TestContext } from '$lib/testing/context';
// Pins the Card manager's behaviour before its controller moves to
// lib/study/cardActions.ts: the same scenarios must pass unchanged after.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/commands/cards', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/commands/cards')>()),
	deleteCards: vi.fn(),
	moveCards: vi.fn(),
	restoreCards: vi.fn()
}));

import { PartialCardsError, deleteCards, moveCards, restoreCards } from '$lib/study/commands/cards';
import type { Deck, StudyCard } from '$lib/study/types';
import CardManager from './CardManager.svelte';
import * as build from '$lib/testing/study';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

function card(entryId: number, written: string, deckIds = ['general']): StudyCard {
	return build.card({ id: `c-vocab-${entryId}`, entryId, written, deckIds, createdAt: `2026-01-0${entryId}T00:00:00.000Z` });
}
const CARDS = [card(1, '好'), card(2, '喜欢'), card(3, '你')];
const DECKS: Deck[] = [{ id: 'verbs', name: 'Verbs', createdAt: '2026-01-01T00:00:00.000Z' }];

let onchanged: ReturnType<typeof vi.fn<() => Promise<void>>>;

async function open(): Promise<void> {
	onchanged = vi.fn<() => Promise<void>>(async () => {});
	render(CardManager, { props: { workspaceId: 7, cards: CARDS, decks: DECKS, onchanged }, context: ctx.context });
	const summary = screen.getByText(/Manage cards/);
	await fireEvent.click(summary);
}

beforeEach(() => {
	vi.mocked(deleteCards).mockImplementation(async (_study, _ws, ids) => CARDS.filter((c) => ids.includes(c.id)));
	vi.mocked(moveCards).mockImplementation(async (_study, _ws, ids) => CARDS.filter((c) => ids.includes(c.id)));
	vi.mocked(restoreCards).mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('CardManager behaviour', () => {
	it('deletes one card and undoes it with the removed rows', async () => {
		await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete 好' }));
		await screen.findByText('Card deleted.');
		expect(deleteCards).toHaveBeenCalledWith(expect.anything(), 7, ['c-vocab-1']);
		await waitFor(() => expect(onchanged).toHaveBeenCalled());
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		await waitFor(() => expect(restoreCards).toHaveBeenCalledTimes(1));
		expect(restoreCards).toHaveBeenCalledWith(expect.anything(), 7, [CARDS[0]], { onlyLive: false });
		await waitFor(() => expect(screen.queryByText('Card deleted.')).toBeNull());
	});

	it('bulk move undoes with onlyLive so a card deleted meanwhile stays gone', async () => {
		await open();
		const picks = document.querySelectorAll<HTMLInputElement>('.rows .pick input');
		await fireEvent.click(picks[0]);
		await fireEvent.click(picks[1]);
		const select = screen.getByLabelText('Move to') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'verbs' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Move' }));
		await screen.findByText('Moved 2 cards to Verbs.');
		expect(moveCards).toHaveBeenCalledWith(expect.anything(), 7, ['c-vocab-1', 'c-vocab-2'], 'verbs');
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		await waitFor(() => expect(restoreCards).toHaveBeenCalledTimes(1));
		expect(vi.mocked(restoreCards).mock.calls[0][3]).toEqual({ onlyLive: true });
		expect(vi.mocked(restoreCards).mock.calls[0][2]).toHaveLength(2);
	});

	it('a partial delete failure shows the error and keeps the landed part undoable', async () => {
		vi.mocked(deleteCards).mockRejectedValue(new PartialCardsError('boom', [CARDS[0]], new Error('x')));
		await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete 好' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('boom');
		await screen.findByText('Card deleted.');
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		await waitFor(() => expect(restoreCards).toHaveBeenCalledWith(expect.anything(), 7, [CARDS[0]], { onlyLive: false }));
	});

	it('a failed undo can be retried with the rows still to restore', async () => {
		vi.mocked(restoreCards).mockRejectedValueOnce(new PartialCardsError('no', [CARDS[1]], new Error('x')));
		await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete 喜欢' }));
		await screen.findByText('Card deleted.');
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		await screen.findByRole('alert');
		await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		await waitFor(() => expect(restoreCards).toHaveBeenCalledTimes(2));
		expect(vi.mocked(restoreCards).mock.calls[1][2]).toEqual([CARDS[1]]);
		await waitFor(() => expect(screen.queryByText('Card deleted.')).toBeNull());
	});

	it('a second change replaces the undo slot', async () => {
		await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete 好' }));
		await screen.findByText('Card deleted.');
		await fireEvent.click(screen.getByRole('button', { name: 'Delete 你' }));
		await waitFor(() => expect(deleteCards).toHaveBeenCalledTimes(2));
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		await waitFor(() => expect(restoreCards).toHaveBeenCalledTimes(1));
		expect(restoreCards).toHaveBeenCalledWith(expect.anything(), 7, [CARDS[2]], { onlyLive: false });
	});

	it('the undo timer waits for a running write and then expires the toast', async () => {
		vi.useFakeTimers();
		try {
			await open();
			await fireEvent.click(screen.getByRole('button', { name: 'Delete 好' }));
			await vi.advanceTimersByTimeAsync(0);
			expect(screen.queryByText('Card deleted.')).not.toBeNull();
			await vi.advanceTimersByTimeAsync(10_001);
			expect(screen.queryByText('Card deleted.')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
