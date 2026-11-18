import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Placed } from './anchor';
import type { Annotation } from './types';
import ReviewText from './ReviewText.svelte';
import source from './ReviewText.svelte?raw';

const text = '上个周末才到了山顶，我觉得非常累。';

function annotation(over: Partial<Annotation> = {}): Annotation {
	return {
		id: 'a1',
		quote: '才到了',
		prefix: '上个周末',
		suffix: '山顶',
		correction: '才到',
		explanation: 'why',
		category: 'grammar',
		kind: 'mistake',
		...over
	};
}

function placed(a: Annotation): Placed {
	const start = text.indexOf(a.quote);
	return { annotation: a, start, end: start + a.quote.length };
}

const mistake = annotation();
const suggestion = annotation({ id: 'a2', quote: '非常累', correction: '很累', category: 'style', kind: 'suggestion' });

afterEach(cleanup);

function renderText(openId: string | null = null, onopen = vi.fn()) {
	return render(ReviewText, {
		text,
		placed: [placed(mistake), placed(suggestion)],
		annotations: [mistake, suggestion],
		openId,
		onopen
	});
}

describe('ReviewText (#103)', () => {
	it('draws a mistake and a suggestion as buttons with their kind class', () => {
		renderText();
		const marks = [...document.querySelectorAll('button.mark')];
		expect(marks.map((m) => m.className)).toEqual([
			expect.stringContaining('mistake'),
			expect.stringContaining('suggestion')
		]);
	});

	it('takes the class from the kind only, never from category text', () => {
		const evil = annotation({ category: 'grammar" onclick=x', kind: 'suggestion' });
		render(ReviewText, { text, placed: [placed(evil)], annotations: [evil], openId: null, onopen: vi.fn() });
		const mark = document.querySelector('button.mark')!;
		expect(mark.classList.contains('suggestion')).toBe(true);
		expect(mark.classList.contains('mistake')).toBe(false);
		expect(mark.hasAttribute('onclick')).toBe(false);
	});

	it('names each mark with the quote and its kind', () => {
		renderText();
		const marks = screen.getAllByRole('button');
		expect(marks[0].textContent).toContain('才到了');
		expect(marks[0].textContent?.trim().endsWith('(Mistake)')).toBe(true);
		expect(marks[1].textContent?.trim().endsWith('(Suggestion)')).toBe(true);
	});

	it('opens a mark, marks it expanded and calls onopen', async () => {
		const onopen = vi.fn();
		renderText('a1', onopen);
		const mark = document.querySelectorAll('button.mark')[0] as HTMLButtonElement;
		expect(mark.getAttribute('aria-expanded')).toBe('true');
		expect(mark.classList.contains('open')).toBe(true);
		await fireEvent.click(mark);
		expect(onopen).toHaveBeenCalledWith('a1');
	});

	it('Escape closes the open mark and keeps focus on it', async () => {
		const onopen = vi.fn();
		renderText('a1', onopen);
		const mark = document.querySelectorAll('button.mark')[0] as HTMLButtonElement;
		mark.focus();
		await fireEvent.keyDown(mark, { key: 'Escape' });
		expect(onopen).toHaveBeenCalledWith(null);
		expect(document.activeElement).toBe(mark);
	});

	it('keeps the text exact, with no added whitespace between runs', () => {
		renderText();
		const clone = document.querySelector('.text')!.cloneNode(true) as HTMLElement;
		for (const hidden of clone.querySelectorAll('.visually-hidden')) hidden.remove();
		expect(clone.textContent).toBe(text);
	});

	it('uses wavy mistakes, dotted suggestions, the selected wash and forced colours', () => {
		const style = source.slice(source.indexOf('<style'));
		expect(style).toMatch(/\.mistake\s*\{[^}]*text-decoration:\s*underline wavy var\(--grade-again\)/);
		expect(style).toMatch(/\.suggestion\s*\{[^}]*text-decoration:\s*underline dotted var\(--grade-easy\)/);
		expect(style).toMatch(/\.open\s*\{[^}]*background:\s*var\(--selected-wash\)/);
		expect(style).toMatch(/@media \(forced-colors: active\)/);
		expect(style).toMatch(/CanvasText/);
		expect(style).toMatch(/Highlight/);
	});
});
