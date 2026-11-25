import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store', async (orig) => {
	const real = await orig<typeof import('./store')>();
	return { ...real, loadNote: vi.fn(), saveNote: vi.fn(), deleteNote: vi.fn() };
});

import EntryNote from './EntryNote.svelte';
import { deleteNote, loadNote, saveNote } from './store';

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const note = (text: string) => ({ entryId: 5, text, extra: {} });

describe('EntryNote', () => {
	it('offers to add a note when there is none and saves it', async () => {
		vi.mocked(loadNote).mockResolvedValue(null);
		vi.mocked(saveNote).mockImplementation(async (_ws, _id, text) => note(text));
		render(EntryNote, { workspaceId: 3, entryId: 5 });
		await fireEvent.click(await screen.findByRole('button', { name: 'Add a note' }));
		const box = screen.getByRole('textbox', { name: 'Your note' });
		await fireEvent.input(box, { target: { value: 'Horse\nfour legs' } });
		expect(screen.getByText('15 / 2000')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(saveNote).toHaveBeenCalledWith(3, 5, 'Horse\nfour legs', null);
		const shown = await screen.findByTestId('note-text');
		expect(shown.textContent).toBe('Horse\nfour legs');
		expect(loadNote).toHaveBeenCalledWith(3, 5);
	});

	it('shows a note, edits it prefilled and cancels with Esc', async () => {
		vi.mocked(loadNote).mockResolvedValue(note('old text'));
		render(EntryNote, { workspaceId: 3, entryId: 5 });
		expect((await screen.findByTestId('note-text')).textContent).toBe('old text');
		await fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
		const box = screen.getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement;
		expect(box.value).toBe('old text');
		await fireEvent.input(box, { target: { value: 'changed' } });
		await fireEvent.keyDown(box, { key: 'Escape' });
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.getByTestId('note-text').textContent).toBe('old text');
		expect(saveNote).not.toHaveBeenCalled();
	});

	it('Esc that cancels an IME composition keeps the editor open', async () => {
		vi.mocked(loadNote).mockResolvedValue(note('old text'));
		render(EntryNote, { workspaceId: 3, entryId: 5 });
		await fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }));
		const box = screen.getByRole('textbox', { name: 'Your note' });
		await fireEvent.keyDown(box, { key: 'Escape', isComposing: true });
		await fireEvent.keyDown(box, { key: 'Escape', keyCode: 229 });
		expect(screen.getByRole('textbox', { name: 'Your note' })).toBeTruthy();
	});

	it('disables Save above 2000 characters', async () => {
		vi.mocked(loadNote).mockResolvedValue(null);
		render(EntryNote, { workspaceId: 3, entryId: 5 });
		await fireEvent.click(await screen.findByRole('button', { name: 'Add a note' }));
		const box = screen.getByRole('textbox', { name: 'Your note' });
		await fireEvent.input(box, { target: { value: '😀'.repeat(2001) } });
		expect(screen.getByText('2001 / 2000')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.input(box, { target: { value: '😀'.repeat(2000) } });
		expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('asks before deleting and deletes', async () => {
		vi.mocked(loadNote).mockResolvedValue(note('bye'));
		vi.mocked(deleteNote).mockResolvedValue();
		render(EntryNote, { workspaceId: 3, entryId: 5 });
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete note' }));
		expect(screen.getByText('Delete this note?')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
		expect(deleteNote).not.toHaveBeenCalled();
		expect(screen.getByTestId('note-text').textContent).toBe('bye');
		await fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		expect(deleteNote).toHaveBeenCalledWith(3, 5);
		expect(await screen.findByRole('button', { name: 'Add a note' })).toBeTruthy();
	});

	it('keeps the draft and shows an alert when saving fails', async () => {
		vi.mocked(loadNote).mockResolvedValue(null);
		vi.mocked(saveNote).mockRejectedValue(new Error('offline'));
		render(EntryNote, { workspaceId: 3, entryId: 5 });
		await fireEvent.click(await screen.findByRole('button', { name: 'Add a note' }));
		const box = screen.getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement;
		await fireEvent.input(box, { target: { value: 'my draft' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect((await screen.findByRole('alert')).textContent).toMatch(/could not save/i);
		expect((screen.getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement).value).toBe('my draft');
	});

	it.each([
		'<img src=x onerror=alert(1)>',
		'<script>alert(1)</script>',
		'<a href="javascript:alert(1)">x</a> javascript:alert(1)'
	])('renders %s as literal text', async (text) => {
		vi.mocked(loadNote).mockResolvedValue(note(text));
		const { container } = render(EntryNote, { workspaceId: 3, entryId: 5 });
		expect((await screen.findByTestId('note-text')).textContent).toBe(text);
		expect(container.querySelector('img, script, a')).toBeNull();
	});

	it('renders nothing without a current workspace', async () => {
		const { container } = render(EntryNote, { workspaceId: null, entryId: 5 });
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector('section')).toBeNull();
		expect(loadNote).not.toHaveBeenCalled();
	});

	it('shows a retry when loading fails', async () => {
		vi.mocked(loadNote).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(note('back'));
		render(EntryNote, { workspaceId: 3, entryId: 5 });
		await fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(screen.getByTestId('note-text').textContent).toBe('back'));
	});
});
