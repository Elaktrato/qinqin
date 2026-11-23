import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store', async (importOriginal) => ({
	...(await importOriginal<typeof import('./store')>()),
	saveDeckCardTypes: vi.fn()
}));

import { saveDeckCardTypes } from './store';
import DeckCardTypes from './DeckCardTypes.svelte';

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
		render(DeckCardTypes, {
			workspaceId: 7,
			deckId: 'general',
			deckName: 'General',
			cardTypes: ['reverse'],
			onSaved
		});
		const reverse = screen.getByLabelText(/Reverse/) as HTMLInputElement;
		const cloze = screen.getByLabelText(/Cloze/) as HTMLInputElement;
		expect(reverse.checked).toBe(true);
		expect(cloze.checked).toBe(false);

		await fireEvent.click(cloze);

		expect(saveDeckCardTypes).toHaveBeenCalledWith(7, 'general', ['reverse', 'cloze']);
		await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
	});

	it('switching one off writes the rest', async () => {
		vi.mocked(saveDeckCardTypes).mockResolvedValue({ deckId: 'd1', cardTypes: [], extra: {} });
		render(DeckCardTypes, { workspaceId: 7, deckId: 'd1', deckName: 'HSK', cardTypes: ['reverse'] });
		await fireEvent.click(screen.getByLabelText(/Reverse/));
		expect(saveDeckCardTypes).toHaveBeenCalledWith(7, 'd1', []);
	});

	it('shows an inline error when the write fails and keeps the old state', async () => {
		vi.mocked(saveDeckCardTypes).mockRejectedValue(new Error('offline'));
		render(DeckCardTypes, { workspaceId: 7, deckId: 'd1', deckName: 'HSK', cardTypes: [] });
		const reverse = screen.getByLabelText(/Reverse/) as HTMLInputElement;
		await fireEvent.click(reverse);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('offline');
		await waitFor(() => expect(reverse.checked).toBe(false));
	});
});
