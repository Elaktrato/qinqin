import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Button from './Button.svelte';
import source from './Button.svelte?raw';

const text = (s: string) => createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
	const css = source.slice(source.indexOf('<style>'));
	const i = css.indexOf(`${selector} {`);
	expect(i, selector).toBeGreaterThan(-1);
	return css.slice(i, css.indexOf('}', i));
}

describe('Button', () => {
	it('is a type=button secondary button by default', async () => {
		const onclick = vi.fn();
		render(Button, { children: text('Cancel'), onclick });
		const b = screen.getByRole('button', { name: 'Cancel' });
		expect(b.getAttribute('type')).toBe('button');
		expect(b.className).toContain('secondary');
		await fireEvent.click(b);
		expect(onclick).toHaveBeenCalledOnce();
	});

	it('takes a variant, a tone and a submit type', () => {
		render(Button, { children: text('Save'), variant: 'primary', type: 'submit', tone: 'danger' });
		const b = screen.getByRole('button', { name: 'Save' });
		expect(b.className).toContain('primary');
		expect(b.className).toContain('danger');
		expect(b.getAttribute('type')).toBe('submit');
	});

	it('a submit button may name its form (a Dialog action outside the form)', () => {
		render(Button, { children: text('Delete'), type: 'submit', form: 'f1' });
		expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('form')).toBe('f1');
	});

	it('is a link when given href', () => {
		render(Button, { children: text('Open'), href: '/study', variant: 'plain' });
		const a = screen.getByRole('link', { name: 'Open' });
		expect(a.getAttribute('href')).toBe('/study');
		expect(a.className).toContain('plain');
	});

	it('busy: aria-busy and disabled, so it is not pressed twice', async () => {
		const onclick = vi.fn();
		render(Button, { children: text('Saving'), busy: true, onclick });
		const b = screen.getByRole('button', { name: 'Saving' }) as HTMLButtonElement;
		expect(b.getAttribute('aria-busy')).toBe('true');
		expect(b.disabled).toBe(true);
	});

	it('draws a decorative icon before the text', () => {
		render(Button, { children: text('Add'), icon: 'add' });
		const b = screen.getByRole('button', { name: 'Add' });
		expect(b.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
	});

	it('paints with tokens: soft accent tint for primary, on-accent for filled, hairline for secondary', () => {
		expect(rule('.primary')).toMatch(/background: var\(--primary-wash\)/);
		expect(rule('.primary')).toMatch(/color: var\(--reading-accent\)/);
		expect(rule('.filled')).toMatch(/background: var\(--accent\)/);
		expect(rule('.filled')).toMatch(/color: var\(--on-accent\)/);
		expect(rule('.secondary')).toMatch(/border-color: var\(--hair\)/);
		expect(rule('.danger')).toMatch(/color: var\(--readable-bad\)/);
		// Disabled text stays readable: no opacity fade.
		expect(rule('.button:disabled')).not.toMatch(/opacity/);
		expect(source).toMatch(/@media \(forced-colors: active\)/);
	});
});
