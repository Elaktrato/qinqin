import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';

vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));

import ReverseCard from './ReverseCard.svelte';
import { withShownWritten } from '$lib/study/cardView';
import CardHarness from '../face/testing/CardHarness.svelte';

function entry(over: Partial<Entry> = {}): Entry {
	return {
		id: 1,
		language: 'zh',
		kind: 'word',
		written: '喜欢',
		readings: [{ type: 'pinyin', value: 'xi3 huan5', plain: 'xihuan', ord: 0 }],
		badges: [],
		variants: [],
		sentences: [],
		forms: [{ text: '喜歡', flags: [] }],
		senses: [
			{ dictionaryId: 1, dictionaryName: 'CC-CEDICT', packId: 'c', license: 'x', attribution: 'x', gloss: 'to like' },
			{ dictionaryId: 1, dictionaryName: 'CC-CEDICT', packId: 'c', license: 'x', attribution: 'x', gloss: 'to be fond of' }
		],
		...over
	} as Entry;
}

const item: FlowItem = { cardId: 'companion:reverse:1', kind: 'reverse', entryId: 1, virtual: true, card: null };

afterEach(cleanup);

function setup(over: { revealed?: boolean } = {}) {
	const onDone = vi.fn();
	// The card renders inside the study face (#101): the harness provides it.
	const view = render(CardHarness, {
		card: ReverseCard,
		cardProps: { item, entry: entry(), revealed: over.revealed ?? false, language: 'zh', onDone }
	});
	return { onDone, ...view, component: (view.component as unknown as { cardInstance: () => unknown }).cardInstance() };
}

describe('ReverseCard answer readings', () => {
	it('joins several readings of one kind with " | " under one label', () => {
		render(CardHarness, {
			card: ReverseCard,
			cardProps: {
				item,
				entry: entry({
					readings: [
						{ type: 'pinyin', value: 'xǐ huan', plain: 'xihuan', ord: 0 },
						{ type: 'pinyin', value: 'xǐ huān', plain: 'xihuan', ord: 1 }
					]
				}),
				revealed: true,
				language: 'zh',
				onDone: vi.fn()
			}
		});
		const table = screen.getByRole('table', { name: 'Readings' });
		expect(table.textContent?.replace(/\s+/g, ' ').trim()).toBe('Pinyin xǐ huan | xǐ huān');
	});

	it('a single reading shows the label and the value', () => {
		setup({ revealed: true });
		expect(screen.getByRole('table', { name: 'Readings' }).textContent?.replace(/\s+/g, ' ').trim()).toBe('Pinyin xi3 huan5');
	});
});

describe('ReverseCard', () => {
	it('shows the meaning but never the written form on the front', () => {
		setup();
		expect(screen.getByText('to like')).toBeTruthy();
		expect(screen.queryByText('喜欢')).toBeNull();
		expect(screen.queryByText(/xi/)).toBeNull();
	});

	it('has a visibly labelled, lang-tagged field that takes focus', () => {
		setup();
		const field = screen.getByLabelText('Type the word') as HTMLInputElement;
		expect(field.getAttribute('lang')).toBe('zh');
		expect(document.activeElement).toBe(field);
	});

	it('Enter with the right word suggests Good', async () => {
		const { onDone } = setup();
		const field = screen.getByLabelText('Type the word');
		await fireEvent.input(field, { target: { value: ' 喜 欢 ' } });
		await fireEvent.keyDown(field, { key: 'Enter' });
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onDone.mock.calls[0][0].suggested).toBe(3);
	});

	it('a form is accepted too', async () => {
		const { onDone } = setup();
		const field = screen.getByLabelText('Type the word');
		await fireEvent.input(field, { target: { value: '喜歡' } });
		await fireEvent.keyDown(field, { key: 'Enter' });
		expect(onDone.mock.calls[0][0].suggested).toBe(3);
	});

	it('showing the reading first turns a right answer into Hard and counts a hint', async () => {
		const { onDone } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Show reading' }));
		expect(screen.getByText(/xi/)).toBeTruthy();
		const field = screen.getByLabelText('Type the word');
		await fireEvent.input(field, { target: { value: '喜欢' } });
		await fireEvent.keyDown(field, { key: 'Enter' });
		expect(onDone.mock.calls[0][0].suggested).toBe(2);
		expect(onDone.mock.calls[0][0].meta.hints).toBe(1);
	});

	it('a wrong word suggests Again and counts a mistake', async () => {
		const { onDone } = setup();
		const field = screen.getByLabelText('Type the word');
		await fireEvent.input(field, { target: { value: '高兴' } });
		await fireEvent.keyDown(field, { key: 'Enter' });
		expect(onDone.mock.calls[0][0].suggested).toBe(1);
		expect(onDone.mock.calls[0][0].meta.mistakes).toBe(1);
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
			// Safari: the confirming Enter keydown arrives after compositionend, with keyCode 229.
			await fireEvent.keyDown(field, { key: 'Enter', isComposing: false, keyCode: 229 });
			expect(onDone).not.toHaveBeenCalled();
			// A genuine Enter (keyCode 13) right after the commit acts: Gboard sends it within milliseconds.
			await fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
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

	it('Show answer with nothing typed gives no suggestion', async () => {
		const { onDone } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onDone.mock.calls[0][0].suggested).toBeNull();
	});

	it('shows the word, readings and glosses once revealed, with a status for a typed answer', () => {
		setup({ revealed: true });
		expect(screen.getByText('喜欢')).toBeTruthy();
		expect(screen.getAllByText('to like').length).toBeGreaterThan(0);
	});
});

describe('ReverseCard.finish (the runner key path)', () => {
	it('records the typed answer and the hint, like the Show answer button', async () => {
		const { onDone, component } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Show reading' }));
		await fireEvent.input(screen.getByLabelText('Type the word'), { target: { value: '喜欢' } });
		(component as unknown as { finish: () => void }).finish();
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onDone.mock.calls[0][0].suggested).toBe(2);
		expect(onDone.mock.calls[0][0].meta.hints).toBe(1);
	});
});

describe('ReverseCard on the open page (#101)', () => {
	it('the primary reads Show answer while empty and Check once something is typed', async () => {
		const { onDone } = setup();
		const dock = document.querySelector('.dock')!;
		expect(dock.querySelector('button')?.textContent).toBe('Show answer');
		await fireEvent.input(screen.getByLabelText('Type the word'), { target: { value: '喜欢' } });
		expect(dock.querySelector('button')?.textContent).toBe('Check');
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		expect(onDone.mock.calls[0][0].suggested).toBe(3);
	});

	it('the field is an underline Field with its visible label', () => {
		setup();
		const field = screen.getByLabelText('Type the word');
		expect(field.closest('.field')).not.toBeNull();
		expect(document.querySelector('label.label')?.textContent).toBe('Type the word');
		expect(field.closest('.face-work')).not.toBeNull();
	});

	it('Show reading is a plain button in the work area', () => {
		setup();
		const button = screen.getByRole('button', { name: 'Show reading' });
		expect(button.closest('.face-work')).not.toBeNull();
		expect(button.classList.contains('plain')).toBe(true);
	});

	it('the verdict has a shape next to its text', async () => {
		cleanup();
		const onDone = vi.fn();
		const view = render(CardHarness, {
			card: ReverseCard,
			cardProps: { item, entry: entry(), revealed: false, language: 'zh', onDone }
		});
		await fireEvent.input(screen.getByLabelText('Type the word'), { target: { value: '喜欢' } });
		await view.rerender({ card: ReverseCard, cardProps: { item, entry: entry(), revealed: true, language: 'zh', onDone } });
		const status = screen.getByRole('status');
		expect(status.textContent).toContain('Correct!');
		expect(status.querySelector('svg')).not.toBeNull();
	});
});

describe('ReverseCard with a kana display form (#101, prep-run item 1)', () => {
	it('a kana-row card shows の, not 乃, in the answer', () => {
		const no = withShownWritten(
			entry({
				language: 'ja',
				written: '乃',
				forms: [],
				readings: [{ type: 'kana', value: 'の', plain: 'no', ord: 0 }]
			} as Partial<Entry>),
			'の'
		);
		render(CardHarness, { card: ReverseCard, cardProps: { item, entry: no, revealed: true, language: 'ja', onDone: vi.fn() } });
		expect(document.querySelector('.face-answer .fa-word')?.textContent).toBe('の');
		expect(document.querySelector('.fc')?.textContent).not.toContain('乃');
	});
});
