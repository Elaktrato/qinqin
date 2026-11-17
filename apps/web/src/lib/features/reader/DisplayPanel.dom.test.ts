import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DisplayPanel from './DisplayPanel.svelte';
import { DEFAULT_DISPLAY, type ReaderDisplay } from './displaySettings';
import type { Variant } from './variants';

afterEach(cleanup);

function mount(
	over: Partial<ReaderDisplay> = {},
	props: { hasBookRuby?: boolean; showAll?: boolean; script?: { value: Variant; error?: string } } = {}
) {
	const onchange = vi.fn();
	const ontoggleAll = vi.fn();
	const onscript = vi.fn();
	render(DisplayPanel, {
		display: { ...DEFAULT_DISPLAY, ...over },
		hasBookRuby: props.hasBookRuby ?? true,
		showAll: props.showAll ?? false,
		onchange,
		ontoggleAll,
		script: props.script ? { ...props.script, onchange: onscript } : undefined
	} as never);
	return { onchange, ontoggleAll, onscript };
}

// The panel is a rail panel now (#102): its settings show at once.
async function open() {}

describe('DisplayPanel', () => {
	it('renders its settings without a disclosure button', () => {
		mount();
		expect(screen.queryByRole('button', { name: 'Display' })).toBeNull();
		expect(screen.getByRole('group', { name: 'Reading display' })).toBeTruthy();
		expect(screen.getByRole('radio', { name: /^Always/ })).toBeTruthy();
	});

	it('shows the script choice for Chinese books and saves it', async () => {
		mount();
		expect(screen.queryByRole('combobox', { name: 'Script' })).toBeNull();
		cleanup();
		const { onscript } = mount({}, { script: { value: 'original' } });
		const select = screen.getByRole('combobox', { name: 'Script' }) as HTMLSelectElement;
		expect(select.value).toBe('original');
		await fireEvent.change(select, { target: { value: 'traditional' } });
		expect(onscript).toHaveBeenLastCalledWith('traditional');
		cleanup();
		mount({}, { script: { value: 'simplified', error: 'Could not load the converter.' } });
		expect(screen.getByRole('alert').textContent).toContain('Could not load the converter.');
	});

	it('the legend uses the shared w-new / w-learning classes', () => {
		mount({ highlightWords: true });
		const legend = screen.getByText('New: solid underline').closest('li');
		expect(legend?.querySelector('.w-new')).toBeTruthy();
		expect(screen.getByText('Learning: dotted underline').closest('li')?.querySelector('.w-learning')).toBeTruthy();
	});

	it('the readings radios report their value', async () => {
		const { onchange } = mount();
		await open();
		await fireEvent.click(screen.getByRole('radio', { name: /^Smart/ }));
		expect(onchange).toHaveBeenLastCalledWith({ readings: 'smart' });
		await fireEvent.click(screen.getByRole('radio', { name: /^Always/ }));
		expect(onchange).toHaveBeenLastCalledWith({ readings: 'always' });
	});

	it('the threshold slider exists only in Smart or with highlighting, with its sentence and link', async () => {
		const { onchange } = mount({ readings: 'always' });
		await open();
		expect(screen.queryByRole('slider')).toBeNull();
		cleanup();
		mount({ readings: 'never', highlightWords: true, smartThreshold: 80 });
		await open();
		expect(screen.getByRole('slider', { name: 'A word counts as known from a memory score of 80' })).toBeTruthy();
		cleanup();
		const smart = mount({ readings: 'smart', smartThreshold: 80 });
		await open();
		const slider = screen.getByRole('slider', { name: 'A word counts as known from a memory score of 80' }) as HTMLInputElement;
		expect(slider.min).toBe('10');
		expect(slider.max).toBe('100');
		expect(slider.step).toBe('5');
		expect(screen.getByText(/Hide readings of words with a memory score of 80 or more/)).toBeTruthy();
		expect((screen.getByRole('link', { name: /score/i }) as HTMLAnchorElement).getAttribute('href')).toBe('/stats/characters');
		await fireEvent.input(slider, { target: { value: '70' } });
		expect(smart.onchange).toHaveBeenLastCalledWith({ smartThreshold: 70 });
		expect(onchange).not.toHaveBeenCalled();
	});

	it('the highlighting checkbox reports its value, the legend shows when on', async () => {
		const { onchange } = mount({ highlightWords: false });
		await open();
		const box = screen.getByRole('checkbox', { name: 'Mark words by how well I know them' }) as HTMLInputElement;
		expect(box.checked).toBe(false);
		expect(screen.queryByText('New: solid underline')).toBeNull();
		await fireEvent.click(box);
		expect(onchange).toHaveBeenLastCalledWith({ highlightWords: true });
		cleanup();
		mount({ highlightWords: true });
		await open();
		expect((screen.getByRole('checkbox', { name: 'Mark words by how well I know them' }) as HTMLInputElement).checked).toBe(true);
		expect(screen.getByText('New: solid underline')).toBeTruthy();
		expect(screen.getByText('Learning: dotted underline')).toBeTruthy();
		expect(screen.getByText(/Known words are not marked/)).toBeTruthy();
	});

	it('the Book ruby control is hidden for a book without ruby', async () => {
		mount({}, { hasBookRuby: false });
		await open();
		expect(screen.queryByRole('checkbox', { name: /Book ruby/ })).toBeNull();
		cleanup();
		const { onchange } = mount({ bookRuby: true }, { hasBookRuby: true });
		await open();
		await fireEvent.click(screen.getByRole('checkbox', { name: /Book ruby/ }));
		expect(onchange).toHaveBeenLastCalledWith({ bookRuby: false });
	});

	it('ruby size and font radios report their value', async () => {
		const { onchange } = mount();
		await open();
		await fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
		expect(onchange).toHaveBeenLastCalledWith({ rubyScale: 0.65 });
		await fireEvent.click(screen.getByRole('radio', { name: 'Serif' }));
		expect(onchange).toHaveBeenLastCalledWith({ font: 'serif' });
	});

	it('the default font is named as the app-wide hanzi font it follows', async () => {
		const { onchange } = mount({ font: 'serif' });
		await open();
		// No appearance row loaded: the app-wide default, Sans.
		await fireEvent.click(screen.getByRole('radio', { name: 'App setting (Sans)' }));
		expect(onchange).toHaveBeenLastCalledWith({ font: 'default' });
	});

	it('Show all readings is a pressed toggle, only in Smart', async () => {
		mount({ readings: 'always' });
		await open();
		expect(screen.queryByRole('button', { name: 'Show all readings' })).toBeNull();
		cleanup();
		const { ontoggleAll } = mount({ readings: 'smart' }, { showAll: true });
		await open();
		const toggle = screen.getByRole('button', { name: 'Show all readings' });
		expect(toggle.getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(toggle);
		expect(ontoggleAll).toHaveBeenCalledTimes(1);
	});
});
