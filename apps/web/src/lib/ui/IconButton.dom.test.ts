import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import IconButton from './IconButton.svelte';
import TooltipHarness from './testing/TooltipHarness.svelte';

function tip(): HTMLElement {
	return document.querySelector('[role="tooltip"]') as HTMLElement;
}

describe('IconButton', () => {
	it('is a button named by its label, with a decorative icon', () => {
		render(IconButton, { label: 'Close', icon: 'close' });
		const button = screen.getByRole('button', { name: 'Close' });
		expect(button.getAttribute('type')).toBe('button');
		expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
		expect(button.hasAttribute('title')).toBe(false);
	});

	it('shows its label as a tooltip on hover and hides it when the pointer leaves', async () => {
		render(IconButton, { label: 'Search', icon: 'search' });
		expect(tip().textContent).toBe('Search');
		expect(tip().dataset.open).toBe('false');
		await fireEvent.pointerEnter(screen.getByRole('button').parentElement!);
		expect(tip().dataset.open).toBe('true');
		await fireEvent.pointerLeave(screen.getByRole('button').parentElement!);
		expect(tip().dataset.open).toBe('false');
	});

	it('shows the tooltip on keyboard focus; Escape hides it without reaching the page', async () => {
		render(IconButton, { label: 'Search', icon: 'search' });
		const button = screen.getByRole('button');
		button.focus();
		await tick();
		expect(tip().dataset.open).toBe('true');
		const outer = vi.fn();
		document.addEventListener('keydown', outer);
		await fireEvent.keyDown(button, { key: 'Escape' });
		document.removeEventListener('keydown', outer);
		expect(tip().dataset.open).toBe('false');
		expect(outer).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(button);
		button.blur();
		button.focus();
		await tick();
		expect(tip().dataset.open).toBe('true');
		button.blur();
		await tick();
		expect(tip().dataset.open).toBe('false');
	});

	it('Escape hides a hovered tooltip wherever focus is (WCAG 1.4.13), and stops listening once hidden', async () => {
		render(IconButton, { label: 'Search', icon: 'search' });
		await fireEvent.pointerEnter(screen.getByRole('button').parentElement!);
		expect(tip().dataset.open).toBe('true');
		document.body.focus();
		await fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(tip().dataset.open).toBe('false');
		await fireEvent.pointerLeave(screen.getByRole('button').parentElement!);
		await fireEvent.pointerEnter(screen.getByRole('button').parentElement!);
		expect(tip().dataset.open).toBe('true');
	});

	it('keeps the tooltip out of the accessible name (no double reading)', () => {
		render(IconButton, { label: 'Search', icon: 'search' });
		expect(tip().getAttribute('aria-hidden')).toBe('true');
		expect(screen.getByRole('button').getAttribute('aria-describedby')).toBeNull();
	});

	it('reports a pressed state, runs onclick, and can be disabled', async () => {
		const onclick = vi.fn();
		const { rerender } = render(IconButton, { label: 'Bold', icon: 'display', pressed: true, onclick });
		const button = screen.getByRole('button', { name: 'Bold' });
		expect(button.getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(button);
		expect(onclick).toHaveBeenCalledTimes(1);
		await rerender({ label: 'Bold', icon: 'display', pressed: false, onclick, disabled: true });
		expect(button.getAttribute('aria-pressed')).toBe('false');
		expect((button as HTMLButtonElement).disabled).toBe(true);
	});

	it('is a link when given href', () => {
		render(IconButton, { label: 'Home', icon: 'home', href: '/' });
		const link = screen.getByRole('link', { name: 'Home' });
		expect(link.getAttribute('href')).toBe('/');
	});

	it('its own name and pressed state win over passed-through attributes', () => {
		render(IconButton, { label: 'Bold', icon: 'display', pressed: true, 'aria-label': 'Other', 'aria-pressed': 'false' });
		const button = screen.getByRole('button', { name: 'Bold' });
		expect(button.getAttribute('aria-pressed')).toBe('true');
		render(IconButton, { label: 'Home', icon: 'home', href: '/', 'aria-label': 'Other' });
		expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
	});

	it('refuses an empty or blank label (an unnamed control)', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(() => render(IconButton, { label: '', icon: 'close' })).toThrow(/label/);
		expect(() => render(IconButton, { label: '  ', icon: 'close' })).toThrow(/label/);
		vi.restoreAllMocks();
	});

	it('passes other attributes through (aria-haspopup, aria-expanded) and keeps its own class', () => {
		render(IconButton, { label: 'More', icon: 'more', 'aria-haspopup': 'menu', 'aria-expanded': false, class: 'extra' });
		const button = screen.getByRole('button', { name: 'More' });
		expect(button.className).toContain('icon-button');
		expect(button.className).toContain('extra');
		expect(button.getAttribute('aria-haspopup')).toBe('menu');
		expect(button.getAttribute('aria-expanded')).toBe('false');
	});
});

describe('Tooltip on another trigger', () => {
	it('describes the trigger (aria-describedby) when the text is not its name', async () => {
		render(TooltipHarness);
		const button = screen.getByRole('button', { name: 'Save' });
		const t = tip();
		expect(t.getAttribute('aria-hidden')).toBeNull();
		expect(button.getAttribute('aria-describedby')).toBe(t.id);
		expect(screen.getByRole('button', { description: 'Saves to this device' })).toBe(button);
	});
});
