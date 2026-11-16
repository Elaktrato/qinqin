import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import NoteAnswer from './NoteAnswer.svelte';

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
});
