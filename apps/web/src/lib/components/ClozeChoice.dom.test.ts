import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ClozeChoice from './ClozeChoice.svelte';

afterEach(cleanup);

const choices = ['喜欢', '朋友', '学习'];

describe('ClozeChoice', () => {
	it('renders before, a labelled gap and after, with lang', () => {
		const { container } = render(ClozeChoice, {
			before: '我',
			after: '茶。',
			choices,
			answer: '喜欢',
			onResult: vi.fn(),
			language: 'zh'
		});
		const sentence = container.querySelector('.sentence') as HTMLElement;
		expect(sentence.getAttribute('lang')).toBe('zh');
		expect(sentence.textContent).toContain('我');
		expect(sentence.textContent).toContain('茶。');
		expect(container.querySelectorAll('.gap')).toHaveLength(1);
		expect(container.querySelector('.gap .sr-only')?.textContent).toBe('blank');
	});

	it('renders every extra gap of a parts list as a gap with its hidden label', () => {
		const { container } = render(ClozeChoice, {
			before: ['我'],
			after: ['喝茶，他也', { gap: true }, '。'],
			choices,
			answer: '喜欢',
			onResult: vi.fn(),
			gapLabel: 'gap'
		});
		const gaps = container.querySelectorAll('.gap');
		expect(gaps).toHaveLength(2);
		for (const gap of gaps) expect(gap.querySelector('.sr-only')?.textContent).toBe('gap');
	});

	it('key 2 picks the second choice once, prevents the default, and a second key does nothing', async () => {
		const onResult = vi.fn();
		render(ClozeChoice, { before: '我', after: '茶。', choices, answer: '喜欢', onResult });
		const down = new KeyboardEvent('keydown', { key: '2', cancelable: true, bubbles: true });
		window.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(true);
		expect(onResult).toHaveBeenCalledTimes(1);
		expect(onResult).toHaveBeenCalledWith({ correct: false });
		await fireEvent.keyDown(window, { key: '1' });
		expect(onResult).toHaveBeenCalledTimes(1);
	});

	it('announces the result in a status region and reveals the answer', async () => {
		render(ClozeChoice, { before: '我', after: '茶。', choices, answer: '喜欢', onResult: vi.fn() });
		await fireEvent.click(screen.getByRole('button', { name: /朋友/ }));
		const status = screen.getByRole('status');
		expect(status.textContent).toContain('Not quite');
		expect(status.textContent).toContain('喜欢');
	});
});
