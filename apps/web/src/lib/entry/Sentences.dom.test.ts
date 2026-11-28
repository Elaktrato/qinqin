import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
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

const base = { entryId: 1, pinyin: '', translation: 't', userId: 1 };
const list: Sentence[] = [
	{ ...base, id: 1, sourcePack: 'tatoeba', userId: null, hanzi: '我喜欢茶。', ai: null },
	{ ...base, id: 2, sourcePack: '', hanzi: '我喜欢学习。', ai: { provider: 'anthropic', model: 'claude-opus-5-5' } },
	{ ...base, id: 3, sourcePack: '', hanzi: '书上的句子。' }
];

describe('Sentences (#186)', () => {
	it('marks an AI example with its label and leaves the others as they were', () => {
		render(Sentences, { props: { sentences: list, language: 'zh', term: '喜欢', aiLabelOf: (m) => `AI-written · ${m.model}` } });
		expect(screen.getByText('AI-written · claude-opus-5-5')).toBeTruthy();
		expect(screen.getByText('tatoeba')).toBeTruthy();
		expect(screen.getByText('user #1')).toBeTruthy();
		expect(screen.getAllByText(/AI-written/)).toHaveLength(1);
	});

	it('says "AI-written" without a label', () => {
		render(Sentences, { props: { sentences: list } });
		expect(screen.getByText('AI-written')).toBeTruthy();
	});
});

describe('Sentences: own sentences can be removed (#279)', () => {
	const marker = (kind: string) =>
		createRawSnippet((sentence: () => Sentence, id: () => string) => ({
			render: () => `<button data-kind="${kind}" data-id="${sentence().id}" aria-describedby="${id()}">x</button>`
		}));

	it('renders ownActions after the learner own sentences only, actions after AI ones', () => {
		const { container } = render(Sentences, { props: { sentences: list, actions: marker('ai'), ownActions: marker('own') } });
		const buttons = [...container.querySelectorAll('button[data-kind]')].map((b) => `${b.getAttribute('data-kind')}:${b.getAttribute('data-id')}`);
		expect(buttons).toEqual(['ai:2', 'own:3']);
		expect(container.querySelector('button[data-kind="own"]')?.getAttribute('aria-describedby')).toBe('sentence-3');
	});
});
