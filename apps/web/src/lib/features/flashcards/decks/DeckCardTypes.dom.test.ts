import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$lib/study/commands/decks', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/commands/decks')>()),
	saveDeckCardTypes: vi.fn()
}));

import { saveDeckCardTypes } from '$lib/study/commands/decks';
import DeckCardTypes from './DeckCardTypes.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('DeckCardTypes', () => {
	it('shows the stored switches and writes the new list on toggle', async () => {
		vi.mocked(saveDeckCardTypes).mockResolvedValue({
			deckId: 'general',
			cardTypes: ['reverse', 'cloze'],
			extra: {}
		});
		const onSaved = vi.fn();
		render(DeckCardTypes, { props: {
			workspaceId: 7,
			deckId: 'general',
			deckName: 'General',
			cardTypes: ['reverse'],
			onSaved
		}, context: ctx.context });
		const reverse = screen.getByLabelText(/Reverse/) as HTMLInputElement;
		const cloze = screen.getByLabelText(/Cloze/) as HTMLInputElement;
		expect(reverse.checked).toBe(true);
		expect(cloze.checked).toBe(false);

		await fireEvent.click(cloze);

		expect(saveDeckCardTypes).toHaveBeenCalledWith(expect.anything(), 7, 'general', ['reverse', 'cloze']);
		await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
	});

	it('switching one off writes the rest', async () => {
		vi.mocked(saveDeckCardTypes).mockResolvedValue({ deckId: 'd1', cardTypes: [], extra: {} });
		render(DeckCardTypes, { props: { workspaceId: 7, deckId: 'd1', deckName: 'HSK', cardTypes: ['reverse'] }, context: ctx.context });
		await fireEvent.click(screen.getByLabelText(/Reverse/));
		expect(saveDeckCardTypes).toHaveBeenCalledWith(expect.anything(), 7, 'd1', []);
	});

	it('shows an inline error when the write fails and keeps the old state', async () => {
		vi.mocked(saveDeckCardTypes).mockRejectedValue(new Error('offline'));
		render(DeckCardTypes, { props: { workspaceId: 7, deckId: 'd1', deckName: 'HSK', cardTypes: [] }, context: ctx.context });
		const reverse = screen.getByLabelText(/Reverse/) as HTMLInputElement;
		await fireEvent.click(reverse);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('Could not save this setting.');
		await waitFor(() => expect(reverse.checked).toBe(false));
	});
});
