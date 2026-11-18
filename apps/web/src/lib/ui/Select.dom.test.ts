import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Select from './Select.svelte';
import SelectHarness from './testing/SelectHarness.svelte';
import source from './Select.svelte?raw';

const options = [
	{ value: 'level', label: 'HSK level' },
	{ value: 'grade', label: 'Grade' },
	{ value: 'frequency', label: 'Frequency' }
];

describe('Select', () => {
	it('renders a labelled select with the options', () => {
		render(Select, { label: 'Group by', value: 'grade', options });
		const select = screen.getByLabelText('Group by') as HTMLSelectElement;
		expect(select.tagName).toBe('SELECT');
		expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
			['level', 'HSK level'],
			['grade', 'Grade'],
			['frequency', 'Frequency']
		]);
		expect(select.value).toBe('grade');
		const label = document.querySelector('label')!;
		expect(label.className).not.toContain('visually-hidden');
	});

	it('renders option groups after the plain options', () => {
		render(Select, {
			label: 'Level',
			value: '7:70',
			options: [{ value: 'all', label: 'All levels' }],
			groups: [
				{
					id: '7',
					label: 'JLPT kanji',
					options: [{ value: '7:70', label: 'N5' }, { value: '7:71', label: 'N4' }]
				},
				{ id: '8', label: 'HSK 3.0', options: [{ value: '8:80', label: 'HSK 1' }] }
			]
		});
		const select = screen.getByLabelText('Level') as HTMLSelectElement;
		expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
			'JLPT kanji',
			'HSK 3.0'
		]);
		expect([...select.options].map((option) => option.textContent)).toEqual([
			'All levels',
			'N5',
			'N4',
			'HSK 1'
		]);
		expect(select.value).toBe('7:70');
	});

	it('binds its value both ways', async () => {
		render(SelectHarness);
		const select = screen.getByLabelText('Group by') as HTMLSelectElement;
		expect(select.value).toBe('b');
		await fireEvent.change(select, { target: { value: 'c' } });
		expect(screen.getByTestId('echo').textContent).toBe('c');
		await fireEvent.click(screen.getByRole('button', { name: 'Set a' }));
		expect(select.value).toBe('a');
		expect(screen.getByTestId('echo').textContent).toBe('a');
	});

	it('links the hint and the error, and error sets aria-invalid', () => {
		render(Select, {
			label: 'Group by',
			value: 'level',
			options,
			hint: 'One grouping at a time',
			error: 'Choose a grouping'
		});
		const select = screen.getByLabelText('Group by');
		expect(select.getAttribute('aria-invalid')).toBe('true');
		expect(
			screen.getByRole('combobox', { description: 'One grouping at a time Choose a grouping' })
		).toBe(select);
	});

	it('renders option groups after the plain options', () => {
		render(Select, {
			label: 'Provider',
			value: '',
			options: [{ value: '', label: 'Choose' }],
			groups: [{ label: 'Built in', options: [{ value: 'a', label: 'A' }] }]
		});
		const select = screen.getByLabelText('Provider') as HTMLSelectElement;
		expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Built in']);
		expect([...select.options].map((o) => o.value)).toEqual(['', 'a']);
	});

	it('hideLabel keeps the label for assistive technology', () => {
		render(Select, { label: 'Group by', value: 'level', options, hideLabel: true });
		expect(screen.getByRole('combobox', { name: 'Group by' })).toBeTruthy();
		expect(document.querySelector('label')!.className).toContain('visually-hidden');
	});

	it('disables the select when asked', () => {
		render(Select, { label: 'Group by', value: 'level', options, disabled: true });
		expect((screen.getByLabelText('Group by') as HTMLSelectElement).disabled).toBe(true);
	});

	it('refuses an empty or blank label', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(() => render(Select, { label: '', options })).toThrow(/label/);
		expect(() => render(Select, { label: ' ', options })).toThrow(/label/);
		vi.restoreAllMocks();
	});

	it('is an underline with the native arrow and no literal colour', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/border-bottom: 1px solid var\(--line\)/);
		expect(css).toMatch(/:focus[^{]*\{[^}]*box-shadow: 0 1px 0 0 var\(--accent\)/);
		expect(css).not.toMatch(/appearance:\s*none/);
		expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
		expect(css).toMatch(/@media \(forced-colors: active\)/);
		expect(css).toMatch(/CanvasText/);
		expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
		expect(css).toMatch(/transition:\s*none/);
	});
});
