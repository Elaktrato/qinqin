import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '$lib/api/types';
import type { EntryPicture } from '$lib/api/images';
import type { FlowItem } from '$lib/study/cardFlow';
import { starterFront } from '$lib/study/starter';

vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));

import VocabCard from './VocabCard.svelte';
import CardHarness from '../face/testing/CardHarness.svelte';

// Starter mode (#214): the front of a vocab card at each stage of one word, and the picture as a hint or always.
const entry = {
	id: 1,
	language: 'ja',
	kind: 'word',
	written: '林檎',
	readings: [
		{ type: 'kana', value: 'りんご', plain: 'ringo', ord: 0 },
		{ type: 'romaji', value: 'ringo', plain: 'ringo', ord: 1 }
	],
	badges: [],
	variants: [],
	sentences: [],
	senses: [{ dictionaryId: 1, dictionaryName: 'JMdict', packId: 'j', license: 'x', attribution: 'x', gloss: 'apple' }]
} as unknown as Entry;
const item: FlowItem = { cardId: 'c-vocab-1', kind: 'vocab', entryId: 1, virtual: false, card: null };
const plain = { usuallyKana: false };

const picture: EntryPicture = {
	packId: 'images-openmoji',
	concept: '1F34E',
	label: 'red apple',
	credit: 'OpenMoji, Liz Bravo',
	license: 'CC BY-SA 4.0',
	attribution: 'x',
	basis: 'manual',
	sense: 0,
	score: 100,
	svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><path fill="none" stroke="#000" d="M1 2h3"/></svg>'
};

afterEach(cleanup);

function setup(stage: number, extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
	const front = starterFront('ja', stage, plain, entry);
	return render(CardHarness, {
		card: VocabCard,
		cardProps: { item, entry, revealed: false, onDone: vi.fn(), starter: { front, note: null }, ...props },
		...extra
	});
}

describe('the Starter front of a Japanese word', () => {
	it('stage 1: romaji only, no kana and no kanji', () => {
		setup(1);
		const front = screen.getByTestId('starter-front');
		expect(front.textContent?.trim()).toBe('ringo');
		expect(front.querySelector('[lang="ja-Latn"]')).not.toBeNull();
		expect(screen.queryByText('りんご')).toBeNull();
		expect(screen.queryByText('林檎')).toBeNull();
	});

	it('stage 2: kana large with the romaji under it', () => {
		setup(2);
		expect(screen.getByTestId('starter-front').textContent?.trim()).toBe('りんご');
		expect(screen.getByText('ringo').closest('.starter-below')).not.toBeNull();
	});

	it('stage 3: kana only', () => {
		setup(3);
		expect(screen.getByTestId('starter-front').textContent?.trim()).toBe('りんご');
		expect(document.querySelector('.starter-below')).toBeNull();
	});

	it('stage 5: the word with its reading above as ruby', () => {
		setup(5);
		const ruby = screen.getByTestId('starter-front').querySelector('ruby')!;
		expect(ruby.querySelector('rt')?.textContent).toBe('りんご');
		expect(ruby.textContent).toContain('林檎');
	});

	it('the normal card (no front) shows the written word', () => {
		render(CardHarness, { card: VocabCard, cardProps: { item, entry, revealed: false, onDone: vi.fn(), starter: { front: null, note: null } } });
		expect(screen.queryByTestId('starter-front')).toBeNull();
		expect(document.querySelector('.fp-word')?.textContent?.trim()).toBe('林檎');
	});

	it('shows the "New" note once, as a status', () => {
		const front = starterFront('ja', 2, plain, entry);
		render(CardHarness, {
			card: VocabCard,
			cardProps: { item, entry, revealed: false, onDone: vi.fn(), starter: { front, note: 'New: now with hiragana' } }
		});
		const note = screen.getByTestId('starter-note');
		expect(note.getAttribute('role')).toBe('status');
		expect(note.textContent).toBe('New: now with hiragana');
	});

	it('still shows the meaning only in the answer', async () => {
		setup(1);
		expect(screen.queryByText('apple')).toBeNull();
		cleanup();
		setup(1, {}, { revealed: true });
		expect(screen.getByText('apple')).toBeTruthy();
	});
});

describe('the picture on a Starter card (#216)', () => {
	it('is on the front from the start when the stage shows it', () => {
		setup(1, { hintPlan: { always: ['picture'], onRequest: [] }, picture });
		const drawing = screen.getByRole('img', { name: 'red apple' });
		expect(drawing.querySelector('svg')).not.toBeNull();
		expect(screen.getByText('OpenMoji, Liz Bravo, CC BY-SA 4.0')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Hint' })).toBeNull();
	});

	it('is hidden behind the Hint button at stage 4 and 5', async () => {
		setup(4, { hintPlan: { always: [], onRequest: ['picture'] }, picture });
		expect(screen.queryByRole('img', { name: 'red apple' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
		expect(screen.getByRole('img', { name: 'red apple' })).toBeTruthy();
	});

	it('draws black outlines in the text colour', () => {
		setup(1, { hintPlan: { always: ['picture'], onRequest: [] }, picture });
		const path = screen.getByRole('img', { name: 'red apple' }).querySelector('path')!;
		expect(path.getAttribute('stroke')).toBe('currentColor');
	});
});
