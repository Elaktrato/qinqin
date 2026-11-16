import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';

vi.mock('$lib/api/entries', () => ({ addSentence: vi.fn(), getEntry: vi.fn() }));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	addCard: vi.fn(async () => ({})),
	setKnownMark: vi.fn(async () => {})
}));
vi.mock('$lib/study/studyData', () => ({
	getStudyData: vi.fn(async () => ({ decks: [], cards: [] })),
	hasCard: vi.fn(() => false)
}));

import { addCard, setKnownMark } from '$lib/study/store';
import { getStudyData } from '$lib/study/studyData';
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

describe('I know this', () => {
	const mount = (over: Record<string, unknown> = {}) =>
		render(AddToStudyButtons, { result: result('word'), workspaceId: 3, paragraph: null, hold: vi.fn(), ...over } as never);
	const toggle = async () => {
		const b = (await screen.findByRole('button', { name: 'I know this' })) as HTMLButtonElement;
		await waitFor(() => expect(b.disabled).toBe(false));
		return b;
	};

	it('starts pressed when the word is marked', async () => {
		vi.mocked(getStudyData).mockResolvedValueOnce({ decks: [], cards: [], known: [11] });
		mount();
		const b = await toggle();
		await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('true'));
	});

	it('marks in the book workspace, a second click unmarks', async () => {
		mount();
		const b = await toggle();
		expect(b.getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(b);
		await waitFor(() => expect(setKnownMark).toHaveBeenLastCalledWith(3, 11, true));
		await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('true'));
		await fireEvent.click(b);
		await waitFor(() => expect(setKnownMark).toHaveBeenLastCalledWith(3, 11, false));
		await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('false'));
	});

	it('a failed write restores the state and says so', async () => {
		vi.mocked(setKnownMark).mockRejectedValueOnce(new Error('offline'));
		mount();
		const b = await toggle();
		await fireEvent.click(b);
		await screen.findByText('Could not save this mark.');
		expect(b.getAttribute('aria-pressed')).toBe('false');
	});

	it('shows the state line only when given', async () => {
		mount({ stateLine: 'Known — memory score 85' });
		expect(await screen.findByText('Known — memory score 85')).toBeTruthy();
		cleanup();
		mount();
		await toggle();
		expect(screen.queryByText(/memory score|New word|Learning/)).toBeNull();
	});
});
