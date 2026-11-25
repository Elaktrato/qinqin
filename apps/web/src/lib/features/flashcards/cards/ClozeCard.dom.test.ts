import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Sentence } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';
import { clozePrompt } from '$lib/study/cloze';

import ClozeCard from './ClozeCard.svelte';
import CardHarness from '../face/testing/CardHarness.svelte';

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
	// The card renders inside the study face (#101): the harness provides it.
	const props = {
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
	};
	const view = render(CardHarness, { card: ClozeCard, cardProps: props, kindLabel: 'Fill the gap', done: props.done as boolean });
	return { onDone, props, ...view };
}

describe('ClozeCard and an AI example (#186)', () => {
	it('marks a sentence an AI wrote, and no other', () => {
		setup({ sentence: { ...sentence, ai: { provider: 'anthropic', model: 'm' } } });
		expect(screen.getByText('AI-written')).toBeTruthy();
		cleanup();
		setup();
		expect(screen.queryByText('AI-written')).toBeNull();
	});
});

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

	it('ignores Enter through a whole composition (Gboard: isComposing false) and acts on Enter after it', async () => {
		vi.useFakeTimers();
		try {
			const { onDone } = setup();
			const field = screen.getByLabelText('Type the word');
			await fireEvent.compositionStart(field);
			await fireEvent.compositionUpdate(field, { data: 'xi' });
			await fireEvent.input(field, { target: { value: '喜欢' } });
			await fireEvent.keyDown(field, { key: 'Enter', isComposing: false });
			expect(onDone).not.toHaveBeenCalled();
			await fireEvent.compositionEnd(field, { data: '喜欢' });
			// Safari: the confirming Enter keydown arrives after compositionend.
			await fireEvent.keyDown(field, { key: 'Enter', isComposing: false });
			expect(onDone).not.toHaveBeenCalled();
			vi.advanceTimersByTime(100);
			await fireEvent.keyDown(field, { key: 'Enter' });
			expect(onDone).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
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
		// The IME guard's window after a compositionend (an earlier test's) must have passed.
		await new Promise((r) => setTimeout(r, 60));
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

describe('ClozeCard on the open page (#101)', () => {
	const choices = ['朋友', '喜欢', '学习', '工作'];

	it('type mode: primary Check disabled while empty, Show answer is a plain button in the work area', async () => {
		const { onDone } = setup();
		const check = screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement;
		expect(check.closest('.dock')).not.toBeNull();
		expect(check.disabled).toBe(true);
		const giveUp = screen.getByRole('button', { name: 'Show answer' });
		expect(giveUp.closest('.face-work')).not.toBeNull();
		expect(giveUp.classList.contains('plain')).toBe(true);
		await fireEvent.input(screen.getByLabelText('Type the word'), { target: { value: '喜欢' } });
		expect(check.disabled).toBe(false);
		await fireEvent.click(check);
		expect(onDone.mock.calls[0][0].suggested).toBe(3);
	});

	it('marks the correct gap with a check icon once done', async () => {
		const view = setup();
		const field = screen.getByLabelText('Type the word');
		await fireEvent.input(field, { target: { value: '喜欢' } });
		await fireEvent.keyDown(field, { key: 'Enter' });
		await waitFor(() => expect(document.querySelector('.gap.right')).not.toBeNull());
		await view.rerender({ card: ClozeCard, cardProps: { ...view.props, done: true }, kindLabel: 'Fill the gap', done: true });
		expect(document.querySelector('.gap.right svg')).not.toBeNull();
	});

	it('choose mode: primary Show answer gives up; choices are buttons with their digit', async () => {
		const { onDone } = setup({ mode: 'choose', choices });
		const buttons = [...document.querySelectorAll('.face-work .choice')] as HTMLButtonElement[];
		expect(buttons.map((b) => b.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3', '4']);
		expect(buttons.map((b) => b.querySelector('kbd')?.textContent)).toEqual(['1', '2', '3', '4']);
		const giveUp = screen.getByRole('button', { name: 'Show answer' });
		expect(giveUp.closest('.dock')).not.toBeNull();
		await fireEvent.click(giveUp);
		expect(onDone.mock.calls[0][0].suggested).toBe(1);
	});

	it('the sentence is the prompt; the feedback has a shape', async () => {
		setup();
		expect(document.querySelector('.face-prompt .fp-sentence')).not.toBeNull();
		await fireEvent.input(screen.getByLabelText('Type the word'), { target: { value: '喜欢' } });
		await fireEvent.keyDown(screen.getByLabelText('Type the word'), { key: 'Enter' });
		const status = screen.getByRole('status');
		expect(status.textContent).toContain('Correct!');
		expect(status.querySelector('svg')).not.toBeNull();
	});
});
