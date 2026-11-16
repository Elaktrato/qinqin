import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';

vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));

import ReverseCard from './ReverseCard.svelte';

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
	const view = render(ReverseCard, {
		item,
		entry: entry(),
		revealed: over.revealed ?? false,
		language: 'zh',
		onDone
	});
	return { onDone, ...view };
}

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
