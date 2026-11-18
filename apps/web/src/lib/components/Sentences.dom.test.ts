import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Sentence } from '$lib/api/types';
import Sentences from './Sentences.svelte';
import source from './Sentences.svelte?raw';

const sentence: Sentence = {
	id: 1,
	entryId: 5,
	sourcePack: 'sample',
	userId: null,
	hanzi: '他每天都勤奋地学习。',
	pinyin: 'tā měi tiān dōu qínfèn de xuéxí.',
	translation: 'He studies diligently every day.'
};

afterEach(cleanup);

describe('Sentences as Examples (#104)', () => {
	it('sets the target word in <b> and hides the uppercase label', () => {
		const { container } = render(Sentences, { sentences: [sentence], language: 'zh', term: '勤奋' });
		expect(screen.getByText('Examples')).toBeTruthy();
		const words = [...container.querySelectorAll('b')].map((b) => b.textContent);
		expect(words).toEqual(['勤奋']);
		expect(container.querySelector('.hanzi')?.textContent).toBe('他每天都勤奋地学习。');
	});

	it('keeps the translation muted and the source line', () => {
		const { container } = render(Sentences, { sentences: [sentence], language: 'zh', term: '勤奋' });
		expect(container.querySelector('.translation')?.textContent).toBe(
			'He studies diligently every day.'
		);
		expect(container.querySelector('.origin')?.textContent).toBe('sample');
	});

	it('draws no box and no uppercase label', () => {
		const style = source.slice(source.indexOf('<style'));
		expect(style).not.toMatch(/text-transform:\s*uppercase/);
		expect(style).not.toMatch(/border:\s*1px solid/);
		expect(style).toMatch(/\.term\s*\{[^}]*color:\s*var\(--reading-accent\)/);
	});
});
