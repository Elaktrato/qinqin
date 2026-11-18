import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import DrawerHarness from './testing/DrawerHarness.svelte';
import source from './Drawer.svelte?raw';

async function open(props: Record<string, unknown> = {}) {
	const onclose = vi.fn();
	render(DrawerHarness, { onclose, ...props });
	const opener = screen.getByRole('button', { name: 'Open menu' });
	opener.focus();
	await fireEvent.click(opener);
	const drawer = await screen.findByRole('dialog', { name: 'Menu' });
	return { opener, drawer, onclose };
}

function swipe(el: HTMLElement, fromX: number, toX: number) {
	return (async () => {
		await fireEvent.pointerDown(el, { clientX: fromX, clientY: 100, pointerId: 1, isPrimary: true });
		await fireEvent.pointerMove(el, { clientX: toX, clientY: 105, pointerId: 1 });
		await fireEvent.pointerUp(el, { clientX: toX, clientY: 105, pointerId: 1 });
	})();
}

describe('Drawer', () => {
	it('opens as a modal dialog named by its label', async () => {
		const { drawer } = await open();
		expect(drawer.tagName).toBe('DIALOG');
		expect(drawer.getAttribute('aria-modal')).toBe('true');
		expect(drawer.hasAttribute('open')).toBe(true);
	});

	it('focus moves to the first focusable', async () => {
		await open();
		await waitFor(() => expect(document.activeElement?.textContent).toBe('One'));
	});

	it('focus moves to initialFocus when given', async () => {
		await open({ initialFocus: '.two' });
		await waitFor(() => expect(document.activeElement?.textContent).toBe('Two'));
	});

	it('Tab and Shift+Tab wrap inside (fallback path)', async () => {
		const { drawer } = await open();
		const last = screen.getByRole('button', { name: 'Last' });
		const first = screen.getByRole('link', { name: 'One' });
		last.focus();
		await fireEvent.keyDown(drawer, { key: 'Tab' });
		expect(document.activeElement).toBe(first);
		await fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(last);
	});

	it('Escape closes once and focus returns to the opener', async () => {
		const { drawer, opener, onclose } = await open();
		await fireEvent.keyDown(drawer, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(onclose).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId('state').textContent).toBe('closed');
		await waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it('a click on the scrim closes', async () => {
		const { drawer, onclose } = await open();
		// The dialog itself (outside its panel) is the scrim.
		await fireEvent.click(drawer);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('a click inside the panel does not close', async () => {
		const { drawer } = await open();
		await fireEvent.click(drawer.querySelector('.drawer-panel') as HTMLElement);
		expect(screen.getByRole('dialog')).toBeTruthy();
	});

	it('a swipe toward the inline start beyond a third of its width closes; toward the end does not', async () => {
		const { drawer, onclose } = await open();
		const panel = drawer.querySelector('.drawer-panel') as HTMLElement;
		Object.defineProperty(panel, 'offsetWidth', { value: 300, configurable: true });
		await swipe(panel, 250, 200); // 50px: springs back
		expect(screen.getByRole('dialog')).toBeTruthy();
		await swipe(panel, 100, 260); // toward the end
		expect(screen.getByRole('dialog')).toBeTruthy();
		await swipe(panel, 250, 120); // 130px > 100px
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('mirrored in right-to-left: the start is on the right', async () => {
		const { drawer } = await open({ dir: 'rtl' });
		const panel = drawer.querySelector('.drawer-panel') as HTMLElement;
		Object.defineProperty(panel, 'offsetWidth', { value: 300, configurable: true });
		const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration);
		await swipe(panel, 250, 120); // toward the left = the end in rtl
		expect(screen.getByRole('dialog')).toBeTruthy();
		await swipe(panel, 100, 250); // toward the right = the start
		spy.mockRestore();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('anchors at the inline start, slides with --motion-medium, in tokens only', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/inset-inline-start: 0/);
		expect(css).toMatch(/var\(--motion-medium\)/);
		expect(css).toMatch(/background: var\(--chrome\)/);
		expect(css).toMatch(/min\(20rem, 85vw\)/);
		expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
	});
});
