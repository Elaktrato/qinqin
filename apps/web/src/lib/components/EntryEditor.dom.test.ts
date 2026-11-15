import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntryDetail } from '$lib/api/types';

vi.mock('$lib/api/entries', () => ({ getSharedEntry: vi.fn() }));
vi.mock('$lib/api/edit', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/edit')>()),
	updateEntry: vi.fn()
}));

import { updateEntry } from '$lib/api/edit';
import { getSharedEntry } from '$lib/api/entries';
import EntryEditor from './EntryEditor.svelte';

function entry(over: Partial<EntryDetail> = {}): EntryDetail {
	return {
		id: 7,
		language: 'zh',
		kind: 'character',
		written: '发',
		readings: [{ type: 'pinyin', value: 'fā', plain: 'fa', ord: 0 }],
		badges: [],
		variants: [],
		sentences: [],
		senses: [],
		...over
	} as EntryDetail;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('EntryEditor baseline and overlay', () => {
	it('keeps Save disabled until the shared baseline has loaded', async () => {
		let release!: (e: EntryDetail) => void;
		vi.mocked(getSharedEntry).mockReturnValue(new Promise((res) => (release = res)));
		render(EntryEditor, { entry: entry(), onSaved: vi.fn(), onCancel: vi.fn() });
		expect(screen.getByText('Preparing editor…')).toBeTruthy();
		const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		release(entry());
		await waitFor(() => expect(screen.queryByText('Preparing editor…')).toBeNull());
	});

	it('sends an untouched overlay field again when another field is edited', async () => {
		// The caller's overlay changed the written form; the shared one is 發.
		vi.mocked(getSharedEntry).mockResolvedValue(entry({ written: '發' }));
		vi.mocked(updateEntry).mockResolvedValue(entry({ written: '发', readings: [{ type: 'pinyin', value: 'fa1', plain: 'fa', ord: 0 }] }));
		const onSaved = vi.fn();
		render(EntryEditor, { entry: entry(), onSaved, onCancel: vi.fn() });
		const reading = screen.getByLabelText('Reading 1 value');
		await fireEvent.input(reading, { target: { value: 'fa1' } });
		await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.submit(screen.getByRole('form', { name: 'Edit entry' }));
		await waitFor(() => expect(updateEntry).toHaveBeenCalled());
		const [id, patch] = vi.mocked(updateEntry).mock.calls[0];
		expect(id).toBe(7);
		expect(patch.written).toBe('发');
		expect(patch.readings).toEqual([{ type: 'pinyin', value: 'fa1' }]);
		expect(onSaved).toHaveBeenCalled();
	});
});
