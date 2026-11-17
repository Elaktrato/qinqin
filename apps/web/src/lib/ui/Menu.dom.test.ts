import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MenuHarness from './testing/MenuHarness.svelte';
import source from './Menu.svelte?raw';

async function openMenu() {
	const trigger = screen.getByRole('button', { name: 'More actions' });
	await fireEvent.click(trigger);
	const menu = screen.getByRole('menu', { name: 'More actions' });
	return { trigger, menu };
}

describe('Menu', () => {
	it('an icon trigger is a named menu button with a tooltip, closed at first', () => {
		render(MenuHarness);
		const trigger = screen.getByRole('button', { name: 'More actions' });
		expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(screen.getAllByRole('tooltip', { hidden: true }).some((t) => t.textContent === 'More actions')).toBe(true);
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('opens with focus on the checked item; items are menuitem, menuitemradio (checked) and a link', async () => {
		render(MenuHarness);
		const { trigger } = await openMenu();
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		const items = screen.getAllByRole('menuitem');
		expect(items.map((i) => i.textContent?.trim())).toEqual(['Rename', 'Copy', 'Settings']);
		expect(items[2].getAttribute('href')).toBe('/settings');
		const radios = screen.getAllByRole('menuitemradio');
		expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
		expect(screen.getByRole('separator')).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(radios[1]));
		for (const el of [...items, ...radios]) expect(el.getAttribute('tabindex')).toBe('-1');
	});

	it('arrows wrap, Home/End jump, a letter jumps to the next item starting with it', async () => {
		render(MenuHarness);
		const { menu } = await openMenu();
		const label = () => document.activeElement?.textContent?.trim();
		await waitFor(() => expect(label()).toBe('Medium'));
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(label()).toBe('Settings');
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(label()).toBe('Rename');
		await fireEvent.keyDown(menu, { key: 'ArrowUp' });
		expect(label()).toBe('Settings');
		await fireEvent.keyDown(menu, { key: 'Home' });
		expect(label()).toBe('Rename');
		await fireEvent.keyDown(menu, { key: 'End' });
		expect(label()).toBe('Settings');
		await fireEvent.keyDown(menu, { key: 'Home' });
		expect(label()).toBe('Rename');
		await fireEvent.keyDown(menu, { key: 'm' });
		expect(label()).toBe('Medium');
		await fireEvent.keyDown(menu, { key: 'S' });
		expect(label()).toBe('Settings');
		await fireEvent.keyDown(menu, { key: 's' });
		expect(label()).toBe('Small');
	});

	it('selecting runs the item, closes, and returns focus to the trigger', async () => {
		const picked = vi.fn();
		render(MenuHarness, { picked });
		const { trigger } = await openMenu();
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
		expect(picked).toHaveBeenCalledWith('copy');
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(trigger);
		await fireEvent.click(trigger);
		await fireEvent.click(screen.getByRole('menuitemradio', { name: 'Small' }));
		expect(screen.getByTestId('size').textContent).toBe('s');
	});

	it('Escape closes and returns focus; Tab and an outside pointer close without taking focus', async () => {
		render(MenuHarness);
		let { trigger, menu } = await openMenu();
		await fireEvent.keyDown(menu, { key: 'Escape' });
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(trigger);
		({ menu } = await openMenu());
		await fireEvent.keyDown(menu, { key: 'Tab' });
		expect(screen.queryByRole('menu')).toBeNull();
		await openMenu();
		const before = screen.getByRole('button', { name: 'Before' });
		await fireEvent.pointerDown(before);
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('a text trigger is named by its text; the menu has its own name', async () => {
		render(MenuHarness);
		const trigger = screen.getByRole('button', { name: 'Chinese' });
		await fireEvent.click(trigger);
		expect(screen.getByRole('menu', { name: 'Workspaces' })).toBeTruthy();
	});

	it('the popup is a floating layer in tokens and fades with the motion token', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/background: var\(--panel\)/);
		expect(css).toMatch(/border: 1px solid var\(--hair\)/);
		expect(css).toMatch(/box-shadow: var\(--shadow-float\)/);
		expect(css).toMatch(/var\(--motion-fast\)/);
		expect(css).toMatch(/z-index: var\(--layer-float\)/);
	});
});
