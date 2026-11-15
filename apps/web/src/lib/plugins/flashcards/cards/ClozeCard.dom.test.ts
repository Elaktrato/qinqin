import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Sentence } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';
import { clozePrompt } from '$lib/study/cloze';

import ClozeCard from './ClozeCard.svelte';

const entry = { id: 1, language: 'zh', kind: 'word', written: '喜欢', readings: [], senses: [], variants: [], sentences: [], badges: [] } as unknown as Entry;
const sentence = { id: 9, entryId: 1, sourcePack: 'p', userId: null, hanzi: '我喜欢喝茶，他也喜欢。', pinyin: 'wo3 xi3 huan5', translation: 'I like tea, he does too.' } as Sentence;
const item: FlowItem = { cardId: 'companion:cloze:1', kind: 'cloze', entryId: 1, virtual: true, card: null };
const prompt = clozePrompt(sentence.hanzi, [
	{ start: 1, end: 3 },
	{ start: 8, end: 10 }
]);

afterEach(cleanup);

function setup(over: Record<string, unknown> = {}) {
	const onDone = vi.fn();
	const view = render(ClozeCard, {
		item,
		entry,
		sentence,
		prompt,
		mode: 'type',
		choices: [],
		accepted: new Set(['喜欢', '喜歡']),
		language: 'zh',
		done: false,
		onDone,
		...over
	});
	return { onDone, ...view };
}

describe('ClozeCard (type)', () => {
	it('shows the sentence with gaps and the translation, hides the reading', () => {
		const { container } = setup();
		expect(container.querySelectorAll('.gap')).toHaveLength(2);
		expect(screen.getByText('I like tea, he does too.')).toBeTruthy();
		expect(screen.queryByText(/xi3/)).toBeNull();
		expect(container.textContent).not.toContain('喜欢');
	});

	it('focuses a labelled, lang-tagged field', () => {
		setup();
		const field = screen.getByLabelText('Type the word');
		expect(field.getAttribute('lang')).toBe('zh');
		expect(document.activeElement).toBe(field);
	});

	it('Enter with the right word suggests Good', async () => {
		const { onDone } = setup();
		const field = screen.getByLabelText('Type the word');
		await fireEvent.input(field, { target: { value: '喜欢' } });
		await fireEvent.keyDown(field, { key: 'Enter' });
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onDone.mock.calls[0][0].suggested).toBe(3);
	});

	it('Check with a wrong word suggests Again, never Easy', async () => {
		const { onDone } = setup();
		await fireEvent.input(screen.getByLabelText('Type the word'), { target: { value: '朋友' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		expect(onDone.mock.calls[0][0].suggested).toBe(1);
		expect(onDone.mock.calls[0][0].meta.mistakes).toBe(1);
	});

	it('Show answer gives up with Again', async () => {
		const { onDone } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		expect(onDone.mock.calls[0][0].suggested).toBe(1);
	});

	it('Enter while composing neither checks nor reveals', async () => {
		const { onDone } = setup();
		const field = screen.getByLabelText('Type the word');
		await fireEvent.input(field, { target: { value: '喜欢' } });
		await fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
		expect(onDone).not.toHaveBeenCalled();
	});

	it('shows the reading and the answer once done', () => {
		const { container } = setup({ done: true });
		expect(screen.getByText('wo3 xi3 huan5')).toBeTruthy();
		expect(container.textContent).toContain('喜欢');
	});
});

describe('ClozeCard (choose)', () => {
	const choices = ['朋友', '喜欢', '学习', '工作'];

	it('a right pick suggests Good and a wrong one Again, with the digit key preventing default', async () => {
		const { onDone } = setup({ mode: 'choose', choices });
		const down = new KeyboardEvent('keydown', { key: '2', cancelable: true, bubbles: true });
		window.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(true);
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onDone.mock.calls[0][0].suggested).toBe(3);
	});

	it('a wrong pick suggests Again', async () => {
		const { onDone } = setup({ mode: 'choose', choices });
		await fireEvent.click(screen.getByRole('button', { name: /朋友/ }));
		expect(onDone.mock.calls[0][0].suggested).toBe(1);
		expect(onDone.mock.calls[0][0].meta.mistakes).toBe(1);
	});

	it('keeps the translation visible and the reading hidden until done', () => {
		setup({ mode: 'choose', choices });
		expect(screen.getByText('I like tea, he does too.')).toBeTruthy();
		expect(screen.queryByText(/xi3/)).toBeNull();
	});
});

describe('ClozeCard extra gaps', () => {
	it('shows each gap\'s own surface once done', () => {
		const custom = {
			before: ['彼は'],
			after: ['、', { gap: true as const, answer: '食べた' }, '。'],
			answer: '食べて'
		};
		const { container } = setup({ prompt: custom, done: true });
		const gaps = [...container.querySelectorAll('.gap')].map((g) => g.textContent);
		expect(gaps[0]).toContain('食べて');
		expect(gaps[1]).toContain('食べた');
	});
});
