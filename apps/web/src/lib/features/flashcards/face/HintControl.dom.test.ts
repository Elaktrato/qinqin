import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';
import type { HintPlan } from '$lib/study/hints';
import type { CardHints } from './cardHints.svelte';

vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));

import VocabCard from '../cards/VocabCard.svelte';
import CardHarness from './testing/CardHarness.svelte';

const entry = {
	id: 1,
	language: 'ja',
	kind: 'word',
	written: '猫',
	readings: [{ type: 'kana', value: 'ねこ', plain: 'neko', ord: 0 }],
	badges: [],
	variants: [],
	sentences: [],
	senses: [{ dictionaryId: 1, dictionaryName: 'JMdict', packId: 'j', license: 'x', attribution: 'x', gloss: 'cat' }]
} as unknown as Entry;
const item: FlowItem = { cardId: 'c-vocab-1', kind: 'vocab', entryId: 1, virtual: false, card: null };

afterEach(cleanup);

function setup(plan: HintPlan, done = false) {
	const holder: { hints: CardHints | null } = { hints: null };
	const view = render(CardHarness, {
		card: VocabCard,
		cardProps: { item, entry, revealed: done, onDone: vi.fn() },
		hintPlan: plan,
		done,
		onhints: (hints: CardHints) => (holder.hints = hints)
	});
	return { view, holder };
}

describe('the Hint control (#215)', () => {
	it('offers no button and shows no reading when the plan has no hint', () => {
		setup({ always: [], onRequest: [] });
		expect(screen.queryByRole('button', { name: 'Hint' })).toBeNull();
		expect(screen.queryByText('ねこ')).toBeNull();
	});

	it('shows an always-hint from the start without a button', () => {
		setup({ always: ['reading'], onRequest: [] });
		expect(screen.getByText('ねこ')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Hint' })).toBeNull();
	});

	it('hides the reading until the button is pressed, then shows it above the word', async () => {
		setup({ always: [], onRequest: ['reading'] });
		expect(screen.queryByText('ねこ')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
		const reading = screen.getByText('ねこ');
		const word = document.querySelector('.fp-word')!;
		expect(reading.compareDocumentPosition(word) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		// Nothing is left to ask for.
		expect(screen.queryByRole('button', { name: 'Hint' })).toBeNull();
	});

	it('the H key asks for the hint, once per press, and counts it', async () => {
		const { holder } = setup({ always: [], onRequest: ['reading', 'picture'] });
		await fireEvent.keyDown(window, { key: 'h', code: 'KeyH' });
		expect(screen.getByText('ねこ')).toBeTruthy();
		expect(holder.hints?.used).toBe(1);
		// The second hint (picture) has no content to draw yet; the press is still counted in order.
		await fireEvent.keyDown(window, { key: 'h', code: 'KeyH' });
		expect(holder.hints?.used).toBe(2);
		await fireEvent.keyDown(window, { key: 'h', code: 'KeyH' });
		expect(holder.hints?.used).toBe(2);
	});

	it('H typed into a text field is a letter; Alt+H still asks', async () => {
		const { holder } = setup({ always: [], onRequest: ['reading'] });
		const field = document.createElement('input');
		document.body.append(field);
		await fireEvent.keyDown(field, { key: 'h', code: 'KeyH' });
		expect(holder.hints?.used).toBe(0);
		await fireEvent.keyDown(field, { key: '˙', code: 'KeyH', altKey: true });
		expect(holder.hints?.used).toBe(1);
		field.remove();
	});

	it('is gone once the card is answered', () => {
		setup({ always: [], onRequest: ['reading'] }, true);
		expect(screen.queryByRole('button', { name: 'Hint' })).toBeNull();
	});
});
