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

	async function ready(shared: EntryDetail, mine: EntryDetail) {
		vi.mocked(getSharedEntry).mockResolvedValue(shared);
		const onSaved = vi.fn();
		render(EntryEditor, { entry: mine, onSaved, onCancel: vi.fn() });
		await waitFor(() => expect(screen.queryByText('Preparing editor…')).toBeNull());
		return onSaved;
	}
	const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

	it('offers Try again when the baseline cannot be fetched, and recovers', async () => {
		vi.mocked(getSharedEntry).mockRejectedValueOnce(new Error('boom'));
		vi.mocked(getSharedEntry).mockResolvedValueOnce(entry());
		render(EntryEditor, { entry: entry(), onSaved: vi.fn(), onCancel: vi.fn() });
		await screen.findByText('boom');
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(screen.queryByText('boom')).toBeNull());
		expect(getSharedEntry).toHaveBeenCalledTimes(2);
	});

	it('is clean again after a successful save', async () => {
		await ready(entry({ written: '發' }), entry());
		vi.mocked(updateEntry).mockResolvedValue(entry());
		await fireEvent.input(screen.getByLabelText('Reading 1 value'), { target: { value: 'fa1' } });
		await waitFor(() => expect(saveButton().disabled).toBe(false));
		vi.mocked(updateEntry).mockResolvedValue(
			entry({ readings: [{ type: 'pinyin', value: 'fa1', plain: 'fa', ord: 0 }] })
		);
		await fireEvent.submit(screen.getByRole('form', { name: 'Edit entry' }));
		await screen.findByText('Saved.');
		expect(saveButton().disabled).toBe(true);
	});

	it('lets the user revert an overlay field to the shared value', async () => {
		// My overlay changed the written form 發 -> 发; the shared entry has 發.
		await ready(entry({ written: '發' }), entry());
		await fireEvent.input(screen.getByLabelText('Written form'), { target: { value: '發' } });
		await waitFor(() => expect(saveButton().disabled).toBe(false));
		vi.mocked(updateEntry).mockResolvedValue(entry({ written: '發' }));
		await fireEvent.submit(screen.getByRole('form', { name: 'Edit entry' }));
		await waitFor(() => expect(updateEntry).toHaveBeenCalled());
		// No field differs from shared: the patch is empty, which removes the overlay.
		expect(vi.mocked(updateEntry).mock.calls[0][1]).toEqual({});
	});

	it('has a Revert to shared button that restores every field', async () => {
		await ready(entry({ written: '發' }), entry());
		await fireEvent.click(screen.getByRole('button', { name: 'Revert to shared' }));
		expect((screen.getByLabelText('Written form') as HTMLInputElement).value).toBe('發');
		await waitFor(() => expect(saveButton().disabled).toBe(false));
	});

	it('hides Revert to shared when nothing differs from the shared entry', async () => {
		await ready(entry(), entry());
		expect(screen.queryByRole('button', { name: 'Revert to shared' })).toBeNull();
	});

	it('blocks saving a blank reading row and says why', async () => {
		await ready(entry(), entry());
		await fireEvent.click(screen.getByRole('button', { name: 'Add reading' }));
		await fireEvent.input(screen.getByLabelText('Reading 1 value'), { target: { value: 'fa1' } });
		expect(screen.getByText('Every reading needs a type and a value.')).toBeTruthy();
		expect(saveButton().disabled).toBe(true);
	});
});
