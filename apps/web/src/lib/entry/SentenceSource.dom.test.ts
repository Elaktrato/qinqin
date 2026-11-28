import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Sentence, SentenceSource as Source } from '$lib/api/types';
import SentenceSource from './SentenceSource.svelte';
import Sentences from './Sentences.svelte';

afterEach(cleanup);

const source: Source = { kind: 'book', bookId: 5, title: 'Book five', chapter: 2, paragraph: 4, start: 10, end: 12 };

describe('SentenceSource (#280)', () => {
	it('links to the reader at the word', () => {
		render(SentenceSource, { source });
		const link = screen.getByRole('link', { name: 'From Book five, chapter 3' });
		expect(link.getAttribute('href')).toBe('/reader/book/5/2?at=4:10-12');
	});

	it('keeps the title as text once the book is deleted', () => {
		const { container } = render(SentenceSource, { source: { ...source, bookId: null } });
		expect(screen.queryByRole('link')).toBeNull();
		expect(container.textContent).toBe('From Book five, chapter 3 · the book was removed');
	});

	it('is text without a link on a review card', () => {
		const { container } = render(SentenceSource, { source, linked: false });
		expect(screen.queryByRole('link')).toBeNull();
		expect(container.textContent).toBe('From Book five, chapter 3');
	});

	it('replaces the user number on the entry page', () => {
		const own: Sentence = { id: 3, entryId: 1, sourcePack: '', userId: 4, hanzi: '书上的句子。', pinyin: '', translation: '', source };
		const { container } = render(Sentences, { sentences: [own], language: 'zh' });
		expect(screen.getByRole('link', { name: 'From Book five, chapter 3' })).toBeTruthy();
		expect(container.textContent).not.toContain('#4');
	});
});
