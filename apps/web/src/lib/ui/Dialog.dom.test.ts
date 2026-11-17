import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import DialogHarness from './testing/DialogHarness.svelte';
import source from './Dialog.svelte?raw';

async function open(props: Record<string, unknown> = {}) {
	const onclose = vi.fn();
	render(DialogHarness, { onclose, ...props });
	const opener = screen.getByRole('button', { name: 'Open' });
	opener.focus();
	await fireEvent.click(opener);
	const dialog = await screen.findByRole('dialog', { name: 'Delete deck' });
	return { opener, dialog, onclose };
}

describe('Dialog', () => {
	it('is a modal dialog named by its title and described by its description', async () => {
		const { dialog } = await open();
		expect(dialog.tagName).toBe('DIALOG');
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(screen.getByRole('dialog', { description: 'This cannot be undone.' })).toBe(dialog);
		expect(screen.getByRole('heading', { name: 'Delete deck' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy();
	});

	it('focuses the first focusable element, or the one named by initialFocus', async () => {
		await open();
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Type the name' })));
	});

	it('initialFocus picks the element', async () => {
		await open({ initialFocus: '.keep' });
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' })));
	});

	it('Tab and Shift+Tab wrap inside the dialog', async () => {
		const { dialog } = await open();
		const del = screen.getByRole('button', { name: 'Delete' });
		const input = screen.getByRole('textbox');
		del.focus();
		await fireEvent.keyDown(dialog, { key: 'Tab' });
		expect(document.activeElement).toBe(input);
		await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(del);
	});

	it('Escape closes it once and focus returns to the opener', async () => {
		const { opener, dialog, onclose } = await open();
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(onclose).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId('state').textContent).toBe('closed');
		await waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it('the native cancel event closes it too (a browser Escape)', async () => {
		const { dialog, onclose } = await open();
		const cancel = new Event('cancel', { cancelable: true });
		dialog.dispatchEvent(cancel);
		expect(cancel.defaultPrevented).toBe(true);
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('focus moves in as soon as it is mounted open (no wait for a later task)', () => {
		render(DialogHarness, { initialFocus: '.keep', startOpen: true });
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }));
	});

	it('dismissible={false} ignores Escape and cancel (an action is running)', async () => {
		const { dialog, onclose } = await open({ dismissible: false });
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		const cancel = new Event('cancel', { cancelable: true });
		dialog.dispatchEvent(cancel);
		expect(cancel.defaultPrevented).toBe(true);
		expect(screen.getByRole('dialog')).toBe(dialog);
		expect(onclose).not.toHaveBeenCalled();
	});

	it('a native close (a second browser Escape while busy) syncs open and still calls onclose', async () => {
		const { dialog, onclose } = await open({ dismissible: false });
		dialog.dispatchEvent(new Event('close'));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(screen.getByTestId('state').textContent).toBe('closed');
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('a close that follows our own closing does not call onclose again', async () => {
		const { dialog, onclose } = await open();
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		dialog.dispatchEvent(new Event('close'));
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('describedBy names content inside the dialog as its description instead', () => {
		render(DialogHarness, { startOpen: true, describedBy: 'harness-what' });
		expect(screen.getByRole('dialog', { description: 'Three decks go.' })).toBeTruthy();
	});

	it('closing from inside (an action) also returns focus', async () => {
		const { opener } = await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it('is a floating layer in tokens', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/background: var\(--panel\)/);
		expect(css).toMatch(/box-shadow: var\(--shadow-float\)/);
		expect(css).toMatch(/border-radius: var\(--radius-large\)/);
		expect(css).toMatch(/::backdrop/);
	});
});
