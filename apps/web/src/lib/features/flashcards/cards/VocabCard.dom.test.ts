import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '$lib/api/types';
import type { FlowItem } from '$lib/study/cardFlow';

vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));

import VocabCard from './VocabCard.svelte';

function kanji(over: Partial<Entry> = {}): Entry {
	return {
		id: 11,
		language: 'ja',
		kind: 'character',
		written: '学',
		readings: [
			{ type: 'on', value: 'ガク', plain: 'gaku', ord: 0 },
			{ type: 'kun', value: 'まな.ぶ', plain: 'manabu', ord: 1 }
		],
		badges: [],
		variants: [],
		sentences: [
			{ id: 1, entryId: 11, sourcePack: 'p', userId: null, hanzi: '学校', pinyin: '', translation: '' }
		],
		senses: [
			{
				dictionaryId: 1,
				dictionaryName: 'KANJIDIC',
				packId: 'k',
				license: 'x',
				attribution: 'x',
				gloss: 'study'
			}
		],
		...over
	} as Entry;
}

const item: FlowItem = { cardId: 'level:11', kind: 'vocab', entryId: 11, virtual: true, card: null };

afterEach(cleanup);

describe('VocabCard for a character', () => {
	it('shows only the glyph before the reveal', () => {
		render(VocabCard, { item, entry: kanji(), revealed: false, onDone: vi.fn() });
		expect(screen.getByText('学')).toBeTruthy();
		expect(screen.queryByLabelText('Readings')).toBeNull();
		expect(screen.queryByText('学校')).toBeNull();
		expect(screen.queryByText('study')).toBeNull();
	});

	it('shows readings and meanings after the reveal', () => {
		render(VocabCard, { item, entry: kanji(), revealed: true, onDone: vi.fn() });
		expect(screen.getByLabelText('Readings')).toBeTruthy();
		expect(screen.getByText('study')).toBeTruthy();
	});

	it('shows readings only, without an empty gloss block, for a character with no senses', () => {
		render(VocabCard, { item, entry: kanji({ senses: [] }), revealed: true, onDone: vi.fn() });
		expect(screen.getByLabelText('Readings')).toBeTruthy();
		expect(screen.queryByText(/No glosses/)).toBeNull();
		expect(document.querySelector('.dictionary')).toBeNull();
	});

	it('keeps the no-glosses hint for a word with readings but no senses', () => {
		const word = kanji({
			kind: 'word',
			written: '学校',
			senses: [],
			sentences: []
		});
		render(VocabCard, { item, entry: word, revealed: true, onDone: vi.fn() });
		expect(screen.getByText(/No glosses for this word yet/)).toBeTruthy();
	});
});
