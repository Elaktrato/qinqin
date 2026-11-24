import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Correction } from './corrections';
import CorrectionNote from './CorrectionNote.svelte';
import source from './CorrectionNote.svelte?raw';

function correction(over: Partial<Correction> = {}): Correction {
	return {
		annotation: {
			id: 'a1',
			quote: '才到了',
			prefix: '',
			suffix: '山顶',
			correction: '才到',
			explanation: '才 is not followed by 了.',
			category: 'grammar',
			kind: 'mistake'
		},
		kind: 'mistake',
		state: 'placed',
		index: 1,
		...over
	};
}

const props = { explanationLang: 'en', studyLang: 'zh-Hans', id: 'note-a1', onopen: vi.fn() };

afterEach(cleanup);

describe('CorrectionNote (#103)', () => {
	it('collapsed is one button naming kind, category, quote and correction', () => {
		render(CorrectionNote, { correction: correction(), open: false, ...props });
		const button = screen.getByRole('button');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		const name = button.textContent!;
		expect(name).toContain('Mistake');
		expect(name).toContain('Grammar');
		expect(name).toContain('才到了');
		expect(name).toContain('才到');
	});

	it('expanded shows the category, the struck quote, the fix and the explanation', () => {
		render(CorrectionNote, { correction: correction(), open: true, ...props });
		const button = screen.getByRole('button');
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(button.querySelector('s')?.textContent).toBe('才到了');
		expect(button.querySelector('b')?.textContent).toBe('才到');
		expect(button.textContent).toContain('You wrote');
		expect(button.textContent).toContain('Correction');
		expect(button.textContent).toContain('才 is not followed by 了.');
	});

	it('a mistake has a filled dot, a suggestion a ring, both decorative', () => {
		const { unmount } = render(CorrectionNote, { correction: correction(), open: true, ...props });
		const dot = document.querySelector('[data-shape]')!;
		expect(dot.getAttribute('data-shape')).toBe('filled');
		expect(dot.getAttribute('aria-hidden')).toBe('true');
		unmount();
		render(CorrectionNote, { correction: correction({ kind: 'suggestion' }), open: true, ...props });
		expect(document.querySelector('[data-shape]')?.getAttribute('data-shape')).toBe('ring');
	});

	it('renders model text as text', () => {
		render(CorrectionNote, {
			correction: correction({
				annotation: { ...correction().annotation, explanation: '<img src=x onerror=alert(1)>' }
			}),
			open: true,
			...props
		});
		expect(document.querySelector('img')).toBeNull();
		expect(screen.getByRole('button').textContent).toContain('<img src=x onerror=alert(1)>');
	});

	it('quote and correction carry the study lang, the explanation its own', () => {
		render(CorrectionNote, { correction: correction(), open: true, ...props });
		expect(screen.getByRole('button').querySelector('s')?.getAttribute('lang')).toBe('zh-Hans');
		expect(screen.getByRole('button').querySelector('b')?.getAttribute('lang')).toBe('zh-Hans');
		expect(screen.getByRole('button').querySelector('.why')?.getAttribute('lang')).toBe('en');
	});

	it('clicking calls onopen with its id', async () => {
		const onopen = vi.fn();
		render(CorrectionNote, { correction: correction(), open: false, ...props, onopen });
		await fireEvent.click(screen.getByRole('button'));
		expect(onopen).toHaveBeenCalledWith('a1');
	});

	it('uses the readable good colour and hairlines, with a forced-colours block', () => {
		const style = source.slice(source.indexOf('<style'));
		expect(style).toMatch(/\.fix\s*\{[^}]*color:\s*var\(--readable-good\)/);
		expect(style).toMatch(/--hair/);
		expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
		expect(style).toMatch(/@media \(forced-colors: active\)/);
	});
});
