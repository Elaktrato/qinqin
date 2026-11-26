import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Sentence } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';

// Three tokens: the segmenter finds the two words, the full stop is its own tile.
vi.mock('$lib/api/segment', () => ({
	segmentBatch: vi.fn(async () => [
		{ start: 0, end: 1, entryIds: [1] },
		{ start: 1, end: 3, entryIds: [2] }
	])
}));

import SentenceCard from './SentenceCard.svelte';
import CardHarness from '../face/testing/CardHarness.svelte';

const entry = { id: 2, language: 'zh', kind: 'word', written: '喜欢', readings: [], senses: [], variants: [], sentences: [], badges: [] } as unknown as Entry;
const sentence = { id: 5, entryId: 2, sourcePack: 'p', userId: null, hanzi: '我喜欢', pinyin: 'wo3 xi3huan5', translation: 'I like it' } as Sentence;
const item: FlowItem = { cardId: 'c5', kind: 'sentence', entryId: 2, virtual: false, card: null };

afterEach(cleanup);

async function setup(over: Record<string, unknown> = {}) {
	const onDone = vi.fn();
	const props = { item, entry, sentence, tier: 0, seed: 's', language: 'zh', done: false, onDone, ...over };
	const view = render(CardHarness, { card: SentenceCard, cardProps: props, kindLabel: 'Build the sentence' });
	await waitFor(() => expect(screen.getByRole('list', { name: 'Your sentence' })).toBeTruthy());
	return { onDone, ...view };
}

function tiles(): HTMLButtonElement[] {
	return [...screen.getByRole('list', { name: 'Word tiles' }).querySelectorAll('button')];
}

async function placeInOrder(): Promise<void> {
	for (const word of ['我', '喜欢']) await fireEvent.click(screen.getByRole('button', { name: `Place ${word}` }));
}

describe('SentenceCard and an AI example (#186)', () => {
	it('marks a sentence an AI wrote, and no other', async () => {
		await setup({ sentence: { ...sentence, ai: { provider: 'anthropic', model: 'm' } } });
		expect(screen.getByText('AI-written')).toBeTruthy();
		cleanup();
		await setup();
		expect(screen.queryByText('AI-written')).toBeNull();
	});
});

describe('SentenceCard and the credit of a Tatoeba sentence', () => {
	it('credits the author on the answer side only', async () => {
		const credit = { source: 'Tatoeba', id: 4706, owner: 'bunbuku', url: 'https://tatoeba.org/sentences/show/4706', translationId: 1, translationOwner: 'CK', translationUrl: 'https://tatoeba.org/sentences/show/1' };
		await setup({ sentence: { ...sentence, credit } });
		expect(screen.queryByRole('link', { name: 'Tatoeba · bunbuku' })).toBeNull();
		cleanup();
		await setup({ sentence: { ...sentence, credit }, done: true });
		const a = screen.getByRole('link', { name: 'Tatoeba · bunbuku' }) as HTMLAnchorElement;
		expect(a.href).toBe('https://tatoeba.org/sentences/show/4706');
	});
});

describe('SentenceCard on the open page (#101)', () => {
	it('prompt is the translation and "Uses <word>"', async () => {
		await setup();
		const prompt = document.querySelector('.face-prompt')!;
		expect(prompt.textContent).toContain('I like it');
		expect(prompt.textContent).toContain('Uses 喜欢');
		expect(prompt.querySelector('strong')?.textContent).toBe('喜欢');
	});

	it('tiles move from the pool to the slots and back', async () => {
		await setup();
		expect(tiles()).toHaveLength(2);
		await fireEvent.click(screen.getByRole('button', { name: 'Place 我' }));
		expect(tiles()).toHaveLength(1);
		const slots = screen.getByRole('list', { name: 'Your sentence' });
		expect(slots.textContent).toContain('我');
		await fireEvent.click(screen.getByRole('button', { name: 'Remove 我' }));
		expect(tiles()).toHaveLength(2);
	});

	it('primary Check is disabled until a tile is placed and checks', async () => {
		const { onDone } = await setup();
		const check = screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement;
		expect(check.closest('.dock')).not.toBeNull();
		expect(check.disabled).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Place 我' }));
		expect(check.disabled).toBe(false);
		await fireEvent.click(screen.getByRole('button', { name: 'Place 喜欢' }));
		await fireEvent.click(check);
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onDone.mock.calls[0][0].suggested).toBe(3);
	});

	it('a checked but incomplete or wrong sentence counts a wrong check', async () => {
		const { onDone } = await setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Place 喜欢' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Place 我' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		expect(onDone).not.toHaveBeenCalled();
		expect(screen.getByRole('status').textContent).toContain('Not quite. Wrong checks: 1.');
	});

	it('an incomplete sentence checked with one tile counts a wrong check', async () => {
		const { onDone } = await setup();
		const check = screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement;
		await fireEvent.click(screen.getByRole('button', { name: 'Place 我' }));
		expect(check.disabled).toBe(false);
		await fireEvent.click(check);
		expect(onDone).not.toHaveBeenCalled();
		expect(screen.getByRole('status').textContent).toContain('Not quite. Wrong checks: 1.');
	});

	it('placing the last tile with the keyboard focuses the docked Check', async () => {
		await setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Place 我' }), { detail: 0 });
		await fireEvent.click(screen.getByRole('button', { name: 'Place 喜欢' }), { detail: 0 });
		const check = screen.getByRole('button', { name: 'Check' });
		expect(document.activeElement).toBe(check);
	});

	it('Undo and Show answer are secondary in the work area', async () => {
		const { onDone } = await setup();
		const undo = screen.getByRole('button', { name: 'Undo' });
		const show = screen.getByRole('button', { name: 'Show answer' });
		for (const b of [undo, show]) {
			expect(b.closest('.face-work')).not.toBeNull();
			expect(b.classList.contains('secondary')).toBe(true);
		}
		await fireEvent.click(show);
		expect(onDone.mock.calls[0][0].suggested).toBe(1);
	});

	it('the live feedback text is unchanged', async () => {
		await setup();
		await placeInOrder();
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		const status = screen.getByRole('status');
		expect(status.getAttribute('aria-live')).toBe('polite');
		expect(status.textContent).toContain('Correct!');
		expect(status.querySelector('svg')).not.toBeNull();
	});

	it('shows the sentence, its reading and translation below the line once done', async () => {
		await setup({ done: true });
		const answer = document.querySelector('.face-answer')!;
		expect(answer.textContent).toContain('我喜欢');
		expect(answer.textContent).toContain('wo3 xi3huan5');
	});
});
