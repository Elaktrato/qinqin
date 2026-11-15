import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';

vi.mock('$lib/api/entries', () => ({ addSentence: vi.fn(), getEntry: vi.fn() }));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	addCard: vi.fn(async () => ({}))
}));
vi.mock('$lib/study/studyData', () => ({
	getStudyData: vi.fn(async () => ({ decks: [], cards: [] })),
	hasCard: vi.fn(() => false)
}));

import { addCard } from '$lib/study/store';
import AddToStudyButtons from './AddToStudyButtons.svelte';

function result(kind: 'word' | 'character'): LookupResult {
	return {
		entryId: 11,
		kind,
		term: '学',
		reading: '',
		forms: [],
		readings: [],
		matched: '学',
		start: 0,
		end: 1,
		reasons: [],
		tags: [],
		frequencies: [],
		senses: [],
		pri: 0
	} as unknown as LookupResult;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('AddToStudyButtons', () => {
	it('snapshots entryKind for a character result', async () => {
		render(AddToStudyButtons, {
			result: result('character'),
			workspaceId: 1,
			paragraph: null,
			hold: vi.fn()
		});
		const plus = await screen.findByRole('button', { name: "Add 学 to study" });
		await waitFor(() => expect((plus as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(plus);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, opts] = vi.mocked(addCard).mock.calls[0] as unknown as [number, Record<string, unknown>];
		expect(opts.entryKind).toBe('character');
		expect(opts.sentenceId).toBeUndefined();
	});

	it('leaves word cards without it', async () => {
		render(AddToStudyButtons, {
			result: result('word'),
			workspaceId: 1,
			paragraph: null,
			hold: vi.fn()
		});
		const plus = await screen.findByRole('button', { name: "Add 学 to study" });
		await waitFor(() => expect((plus as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(plus);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, opts] = vi.mocked(addCard).mock.calls[0] as unknown as [number, Record<string, unknown>];
		expect(opts.entryKind).toBeUndefined();
	});
});
