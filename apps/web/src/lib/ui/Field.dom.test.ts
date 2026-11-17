import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Field from './Field.svelte';
import FieldHarness from './testing/FieldHarness.svelte';
import source from './Field.svelte?raw';

describe('Field', () => {
	it('labels its input with a visible label', () => {
		render(Field, { label: 'Name', value: 'Mei' });
		const input = screen.getByLabelText('Name') as HTMLInputElement;
		expect(input.tagName).toBe('INPUT');
		expect(input.value).toBe('Mei');
		expect(input.getAttribute('type')).toBe('text');
		const label = document.querySelector('label')!;
		expect(label.className).not.toContain('visually-hidden');
	});

	it('can hide the label visually and keep the name (search fields)', () => {
		render(Field, { label: 'Search', type: 'search', hideLabel: true, placeholder: '汉字' });
		const input = screen.getByRole('searchbox', { name: 'Search' });
		expect(input.getAttribute('placeholder')).toBe('汉字');
		expect(document.querySelector('label')!.className).toContain('visually-hidden');
	});

	it('links the hint and the error, and marks the field invalid', () => {
		render(Field, { label: 'Email', hint: 'We never share it', error: 'Not an email address' });
		const input = screen.getByLabelText('Email');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByRole('textbox', { description: 'We never share it Not an email address' })).toBe(input);
	});

	it('has no aria-invalid and no description when there is neither', () => {
		render(Field, { label: 'Title' });
		const input = screen.getByLabelText('Title');
		expect(input.hasAttribute('aria-invalid')).toBe(false);
		expect(input.hasAttribute('aria-describedby')).toBe(false);
	});

	it('is a textarea when multiline', () => {
		render(Field, { label: 'Note', multiline: true });
		expect(screen.getByLabelText('Note').tagName).toBe('TEXTAREA');
	});

	it('binds its value both ways', async () => {
		render(FieldHarness);
		const input = screen.getByLabelText('Word') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '学' } });
		expect(screen.getByTestId('echo').textContent).toBe('学');
	});

	it('is an underline, not a box; the accent line marks focus', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/border-bottom: 1px solid var\(--line\)/);
		expect(css).toMatch(/:focus[^{]*\{[^}]*box-shadow: 0 1px 0 0 var\(--accent\)/);
		expect(css).toMatch(/color: var\(--readable-bad\)/);
		expect(css).toMatch(/var\(--bad\)/);
		expect(css).toMatch(/@media \(forced-colors: active\)/);
	});
});
