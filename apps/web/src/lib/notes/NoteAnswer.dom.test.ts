import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import NoteAnswer from './NoteAnswer.svelte';
import source from './NoteAnswer.svelte?raw';

afterEach(cleanup);

describe('NoteAnswer', () => {
	it('renders nothing without text', () => {
		const { container } = render(NoteAnswer, { text: undefined });
		expect(container.textContent?.trim()).toBe('');
		render(NoteAnswer, { text: '' });
		expect(screen.queryByRole('note')).toBeNull();
	});

	it('shows the text labelled "Your note", line breaks kept', () => {
		render(NoteAnswer, { text: 'Horse\nfour legs' });
		const box = screen.getByRole('note', { name: 'Your note' });
		expect(box.querySelector('.note-text')?.textContent).toBe('Horse\nfour legs');
	});

	it.each(['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', 'javascript:alert(1)'])(
		'renders %s literally',
		(text) => {
			const { container } = render(NoteAnswer, { text });
			expect(container.querySelector('img, script, a')).toBeNull();
			expect(container.querySelector('.note-text')?.textContent).toBe(text);
		}
	);

	it('is the lighter note of the open page (#101): a warn start line, no fill, muted text', () => {
		const style = source.slice(source.indexOf('<style'));
		expect(style).toMatch(/border-inline-start:\s*2px solid color-mix\(in srgb, var\(--warn\) 60%, transparent\)/);
		expect(style).not.toMatch(/background/);
		expect(style).toMatch(/\.note-text\s*\{[^}]*color:\s*var\(--readable-muted\)/);
		expect(style).toMatch(/h3\s*\{[^}]*color:\s*var\(--text\)/);
	});
});
