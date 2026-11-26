import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Sentence, SentenceCredit } from '$lib/api/types';
import Sentences from './Sentences.svelte';
import SentenceCreditView from './SentenceCredit.svelte';
import { creditText, sentenceShareText } from './shareText';

afterEach(cleanup);

const credit: SentenceCredit = {
	source: 'Tatoeba',
	id: 4706,
	owner: 'bunbuku',
	url: 'https://tatoeba.org/sentences/show/4706',
	translationId: 355041,
	translationOwner: 'CK',
	translationUrl: 'https://tatoeba.org/sentences/show/355041'
};

const sentence: Sentence = {
	id: 1,
	entryId: 5,
	sourcePack: 'ja-sentences-tatoeba',
	userId: null,
	hanzi: 'アルファ。',
	pinyin: '',
	translation: 'Alpha.',
	credit
};

describe('Tatoeba credit of a pack sentence', () => {
	it('names the owner and links the sentence page, and credits the translation', () => {
		render(SentenceCreditView, { credit });
		const a = screen.getByRole('link', { name: 'Tatoeba · bunbuku' }) as HTMLAnchorElement;
		expect(a.href).toBe('https://tatoeba.org/sentences/show/4706');
		expect(a.rel).toContain('noopener');
		const t = screen.getByRole('link', { name: 'translation CK' }) as HTMLAnchorElement;
		expect(t.href).toBe('https://tatoeba.org/sentences/show/355041');
	});

	it('shows just the source when no owner is listed', () => {
		render(SentenceCreditView, { credit: { ...credit, owner: '', translationOwner: '' } });
		expect(screen.getByRole('link', { name: 'Tatoeba' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'translation' })).toBeTruthy();
	});

	it('replaces the bare pack label in the examples list', () => {
		const { container } = render(Sentences, { sentences: [sentence], language: 'ja', term: 'アルファ' });
		expect(container.querySelector('.origin')).toBeNull();
		expect(screen.getByRole('link', { name: 'Tatoeba · bunbuku' })).toBeTruthy();
	});

	it('keeps the pack label for a sentence without a credit', () => {
		const { container } = render(Sentences, { sentences: [{ ...sentence, credit: undefined }], language: 'ja' });
		expect(container.querySelector('.origin')?.textContent).toBe('ja-sentences-tatoeba');
	});

	it('carries the credit into the shared text', () => {
		expect(creditText(credit)).toBe(
			'Tatoeba · bunbuku https://tatoeba.org/sentences/show/4706, translation CK https://tatoeba.org/sentences/show/355041'
		);
		expect(sentenceShareText(sentence, creditText(credit))).toContain('(Tatoeba · bunbuku https://tatoeba.org/sentences/show/4706');
	});
});
