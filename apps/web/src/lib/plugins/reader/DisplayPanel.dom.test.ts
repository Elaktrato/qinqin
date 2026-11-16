import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DisplayPanel from './DisplayPanel.svelte';
import { DEFAULT_DISPLAY, type ReaderDisplay } from './displaySettings';

afterEach(cleanup);

function mount(over: Partial<ReaderDisplay> = {}, props: { hasBookRuby?: boolean; showAll?: boolean } = {}) {
	const onchange = vi.fn();
	const ontoggleAll = vi.fn();
	render(DisplayPanel, {
		display: { ...DEFAULT_DISPLAY, ...over },
		hasBookRuby: props.hasBookRuby ?? true,
		showAll: props.showAll ?? false,
		onchange,
		ontoggleAll
	} as never);
	return { onchange, ontoggleAll };
}

async function open() {
	await fireEvent.click(screen.getByRole('button', { name: 'Display' }));
}

describe('DisplayPanel', () => {
	it('is a disclosure: aria-expanded follows it', async () => {
		mount();
		const button = screen.getByRole('button', { name: 'Display' });
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByRole('group', { name: 'Reading display' })).toBeNull();
		await fireEvent.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(screen.getByRole('group', { name: 'Reading display' })).toBeTruthy();
	});

	it('Escape closes the panel and returns focus to the button', async () => {
		mount();
		await open();
		const radio = screen.getByRole('radio', { name: /^Always/ });
		radio.focus();
		await fireEvent.keyDown(radio, { key: 'Escape' });
		const button = screen.getByRole('button', { name: 'Display' });
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(button);
	});

	it('the readings radios report their value', async () => {
		const { onchange } = mount();
		await open();
		await fireEvent.click(screen.getByRole('radio', { name: /^Smart/ }));
		expect(onchange).toHaveBeenLastCalledWith({ readings: 'smart' });
		await fireEvent.click(screen.getByRole('radio', { name: /^Always/ }));
		expect(onchange).toHaveBeenLastCalledWith({ readings: 'always' });
	});

	it('the threshold slider exists only in Smart, with its sentence and link', async () => {
		const { onchange } = mount({ readings: 'always' });
		await open();
		expect(screen.queryByRole('slider')).toBeNull();
		cleanup();
		const smart = mount({ readings: 'smart', smartThreshold: 80 });
		await open();
		const slider = screen.getByRole('slider') as HTMLInputElement;
		expect(slider.min).toBe('10');
		expect(slider.max).toBe('100');
		expect(slider.step).toBe('5');
		expect(screen.getByText(/Hide readings of words with a memory score of 80 or more/)).toBeTruthy();
		expect((screen.getByRole('link', { name: /score/i }) as HTMLAnchorElement).getAttribute('href')).toBe('/stats/characters');
		await fireEvent.input(slider, { target: { value: '70' } });
		expect(smart.onchange).toHaveBeenLastCalledWith({ smartThreshold: 70 });
		expect(onchange).not.toHaveBeenCalled();
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
