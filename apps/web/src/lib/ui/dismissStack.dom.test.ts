import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import DialogHarness from './testing/DialogHarness.svelte';
import DrawerHarness from './testing/DrawerHarness.svelte';
import MenuInDialogHarness from './testing/MenuInDialogHarness.svelte';
import SheetHarness from './testing/SheetHarness.svelte';
import { dismissTop, hasDismissable } from './dismissStack';

// The overlays of lib/ui register while open, so the Android back button (lib/native) closes them innermost first.
describe('overlays on the dismiss stack', () => {
	it('a Dialog is dismissed from the stack, and leaves it', async () => {
		const onclose = vi.fn();
		render(DialogHarness, { onclose });
		await fireEvent.click(screen.getByRole('button', { name: 'Open' }));
		await screen.findByRole('dialog', { name: 'Delete deck' });
		expect(hasDismissable()).toBe(true);
		expect(dismissTop()).toBe(true);
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(onclose).toHaveBeenCalledOnce();
		expect(hasDismissable()).toBe(false);
		expect(dismissTop()).toBe(false);
	});

	it('a Sheet and a Drawer close the same way', async () => {
		const sheetClosed = vi.fn();
		const { unmount } = render(SheetHarness, { onclose: sheetClosed });
		await fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
		await screen.findByRole('dialog', { name: '学习' });
		expect(dismissTop()).toBe(true);
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(sheetClosed).toHaveBeenCalledOnce();
		unmount();

		const drawerClosed = vi.fn();
		render(DrawerHarness, { onclose: drawerClosed });
		await fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
		await screen.findByRole('dialog', { name: 'Menu' });
		expect(dismissTop()).toBe(true);
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(drawerClosed).toHaveBeenCalledOnce();
	});

	it('back on a Sheet cancels an inline action first, like Escape, and only then closes the sheet', async () => {
		const onclose = vi.fn();
		const onescape = vi.fn();
		render(SheetHarness, { onclose, onescape });
		await fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
		await screen.findByRole('dialog', { name: '学习' });
		screen.getByLabelText('Rename').focus();
		expect(dismissTop()).toBe(true);
		expect(onescape).toHaveBeenCalledOnce();
		expect(onclose).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog', { name: '学习' })).toBeTruthy();
		screen.getByLabelText('Note').focus();
		expect(dismissTop()).toBe(true);
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('a menu inside a dialog closes first, then the dialog', async () => {
		const onclose = vi.fn();
		render(MenuInDialogHarness, { onclose });
		await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
		expect(screen.getByRole('menu')).toBeTruthy();
		expect(dismissTop()).toBe(true);
		await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
		expect(screen.getByRole('dialog', { name: 'Edit deck' })).toBeTruthy();
		expect(onclose).not.toHaveBeenCalled();
		expect(dismissTop()).toBe(true);
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(onclose).toHaveBeenCalledOnce();
	});
});
