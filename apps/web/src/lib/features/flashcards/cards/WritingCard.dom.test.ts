import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';

const { stub } = vi.hoisted(() => ({
	stub: async () => ({ default: (await import('./testing/WritingPadStub.svelte')).default })
}));
vi.mock('./WritingPad.svelte', stub);
vi.mock('$lib/study/strokeData', () => ({
	loadStrokeData: vi.fn(async () => ({ strokes: ['M 0 0 L 1 1'], medians: [[[0, 0], [100, 100]]] }))
}));

import WritingCard from './WritingCard.svelte';
import CardHarness from '../face/testing/CardHarness.svelte';
import padSource from './WritingPad.svelte?raw';

const entry = {
	id: 3,
	language: 'zh',
	kind: 'word',
	written: '你好',
	readings: [{ type: 'pinyin', value: 'nǐ hǎo', plain: 'ni3hao3', ord: 0 }],
	senses: [{ dictionaryId: 1, dictionaryName: 'CC-CEDICT', packId: 'c', license: 'x', attribution: 'x', gloss: 'hello' }],
	variants: [],
	sentences: [],
	badges: []
} as unknown as Entry;
const item: FlowItem = { cardId: 'w3', kind: 'writing', entryId: 3, virtual: false, card: null };

afterEach(cleanup);

async function setup(over: Record<string, unknown> = {}) {
	const onDone = vi.fn();
	const props = { item, entry, chars: ['你', '好'], done: false, onDone, ...over };
	const view = render(CardHarness, { card: WritingCard, cardProps: props, kindLabel: 'Write' });
	await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
	return { onDone, ...view };
}

describe('WritingCard on the open page (#101)', () => {
	it('prompt shows the word with the current character as a box and the reading · meaning below', async () => {
		await setup();
		const prompt = document.querySelector('.face-prompt')!;
		expect(prompt.querySelector('.fp-word')?.textContent?.trim()).toBe('□□');
		expect(prompt.textContent).toContain('nǐ hǎo');
		expect(prompt.textContent).toContain('hello');
	});

	it('primary Show strokes reveals the current character (same outcome and suggestion as before)', async () => {
		const { onDone } = await setup({ chars: ['你'] });
		const show = screen.getByRole('button', { name: 'Show strokes' });
		expect(show.closest('.dock')).not.toBeNull();
		await fireEvent.click(show);
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		expect(onDone.mock.calls[0][0]).toEqual({ suggested: 1, meta: { mistakes: 0, hints: 1 } });
		expect(screen.getByRole('status').textContent).toContain('The character is 你.');
	});

	it('Hint is a secondary button in the work area', async () => {
		await setup();
		const hint = screen.getByRole('button', { name: 'Hint' });
		expect(hint.closest('.face-work')).not.toBeNull();
		expect(hint.classList.contains('secondary')).toBe(true);
	});

	it('the progress dots are a list with the existing labels', async () => {
		await setup();
		const dots = screen.getByRole('list', { name: 'Characters' });
		expect([...dots.querySelectorAll('li')].map((li) => li.getAttribute('aria-label'))).toEqual([
			'Character 1, current',
			'Character 2'
		]);
	});

	it('the canvas keeps role img and its label', async () => {
		await setup();
		expect(screen.getByRole('img', { name: 'Draw character 1 of 2, stroke by stroke' })).toBeTruthy();
	});

	it('the pad is a hairline square and reads its stroke colours from the tokens', () => {
		const style = padSource.slice(padSource.indexOf('<style'));
		expect(style).toMatch(/border:\s*1px solid var\(--hair\)/);
		expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
		expect(padSource).toMatch(/getPropertyValue\('--accent'\)/);
	});
});
