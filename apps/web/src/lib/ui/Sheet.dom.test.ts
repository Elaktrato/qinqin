import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SheetHarness from './testing/SheetHarness.svelte';
import source from './Sheet.svelte?raw';

async function open(props: Record<string, unknown> = {}) {
	const onclose = vi.fn();
	render(SheetHarness, { onclose, ...props });
	const opener = screen.getByRole('button', { name: 'Look up' });
	opener.focus();
	await fireEvent.click(opener);
	const sheet = await screen.findByRole('dialog', { name: '学习' });
	return { opener, sheet, onclose };
}

const handle = (sheet: HTMLElement) => sheet.querySelector('.grab') as HTMLElement;

describe('Sheet', () => {
	it('is a named modal dialog with a Close button that closes it and returns focus', async () => {
		const { opener, sheet, onclose } = await open();
		expect(sheet.tagName).toBe('DIALOG');
		expect(sheet.getAttribute('aria-modal')).toBe('true');
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(onclose).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it('a native close syncs open and calls onclose once', async () => {
		const { sheet, onclose } = await open();
		sheet.dispatchEvent(new Event('close'));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('Escape closes it once; Tab wraps inside', async () => {
		const { sheet, onclose } = await open();
		const close = screen.getByRole('button', { name: 'Close' });
		const note = screen.getByRole('textbox', { name: 'Note' });
		note.focus();
		await fireEvent.keyDown(sheet, { key: 'Tab' });
		expect(document.activeElement).toBe(close);
		await fireEvent.keyDown(sheet, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('Escape that cancels an IME composition in a field does not close the sheet', async () => {
		const { onclose } = await open();
		const note = screen.getByRole('textbox', { name: 'Note' });
		await fireEvent.keyDown(note, { key: 'Escape', isComposing: true });
		await fireEvent.keyDown(note, { key: 'Escape', keyCode: 229 });
		expect(screen.getByRole('dialog')).toBeTruthy();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('a key an inner action took does not close the sheet', async () => {
		const onescape = vi.fn();
		const { sheet, onclose } = await open({ onescape });
		const rename = screen.getByRole('textbox', { name: 'Rename' });
		await fireEvent.keyDown(rename, { key: 'Escape' });
		expect(onescape).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('dialog')).toBe(sheet);
		expect(onclose).not.toHaveBeenCalled();
	});

	it('dragging the handle down far enough closes it; a short drag springs back', async () => {
		const { sheet, onclose } = await open();
		const grab = handle(sheet);
		await fireEvent.pointerDown(grab, { clientX: 100, clientY: 400, pointerId: 1, isPrimary: true });
		await fireEvent.pointerMove(grab, { clientX: 100, clientY: 415, pointerId: 1 });
		await fireEvent.pointerUp(grab, { clientX: 100, clientY: 415, pointerId: 1 });
		expect(screen.getByRole('dialog')).toBeTruthy();
		await fireEvent.pointerDown(grab, { clientX: 100, clientY: 400, pointerId: 1, isPrimary: true });
		await fireEvent.pointerMove(grab, { clientX: 100, clientY: 650, pointerId: 1 });
		await fireEvent.pointerUp(grab, { clientX: 100, clientY: 650, pointerId: 1 });
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('a sideways swipe pages when the caller pages (next = swipe toward the start)', async () => {
		const onnext = vi.fn();
		const onprev = vi.fn();
		const { sheet } = await open({ onnext, onprev });
		const body = sheet.querySelector('.body') as HTMLElement;
		await fireEvent.pointerDown(body, { clientX: 300, clientY: 300, pointerId: 2, isPrimary: true });
		await fireEvent.pointerUp(body, { clientX: 150, clientY: 310, pointerId: 2 });
		expect(onnext).toHaveBeenCalledTimes(1);
		await fireEvent.pointerDown(body, { clientX: 100, clientY: 300, pointerId: 2, isPrimary: true });
		await fireEvent.pointerUp(body, { clientX: 260, clientY: 300, pointerId: 2 });
		expect(onprev).toHaveBeenCalledTimes(1);
		// Mostly vertical: not a page swipe.
		await fireEvent.pointerDown(body, { clientX: 100, clientY: 100, pointerId: 2, isPrimary: true });
		await fireEvent.pointerUp(body, { clientX: 180, clientY: 300, pointerId: 2 });
		expect(onprev).toHaveBeenCalledTimes(1);
		expect(onnext).toHaveBeenCalledTimes(1);
	});

	it('the arrow keys are the keyboard path for paging, not inside a text field', async () => {
		const onnext = vi.fn();
		const onprev = vi.fn();
		const { sheet } = await open({ onnext, onprev });
		screen.getByRole('button', { name: 'Close' }).focus();
		await fireEvent.keyDown(sheet, { key: 'ArrowRight' });
		await fireEvent.keyDown(sheet, { key: 'ArrowLeft' });
		expect(onnext).toHaveBeenCalledTimes(1);
		expect(onprev).toHaveBeenCalledTimes(1);
		const note = screen.getByRole('textbox', { name: 'Note' });
		await fireEvent.keyDown(note, { key: 'ArrowRight' });
		expect(onnext).toHaveBeenCalledTimes(1);
	});

	it('without paging callbacks, swipes and arrows do nothing', async () => {
		const { sheet } = await open();
		const body = sheet.querySelector('.body') as HTMLElement;
		await fireEvent.pointerDown(body, { clientX: 300, clientY: 300, pointerId: 2, isPrimary: true });
		await fireEvent.pointerUp(body, { clientX: 100, clientY: 300, pointerId: 2 });
		expect(screen.getByRole('dialog')).toBeTruthy();
	});

	it('is a bottom floating layer in tokens that slides with the motion token', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/background: var\(--panel\)/);
		expect(css).toMatch(/box-shadow: var\(--shadow-float\)/);
		expect(css).toMatch(/var\(--motion-medium\)/);
		expect(css).toMatch(/touch-action: pan-y/);
		expect(css).toMatch(/inset-block-end: 0|bottom: 0/);
	});
});
