import { describe, expect, it } from 'vitest';
import type { FrequencyPack, Scheme } from '$lib/api/types';
import {
	mixedNote,
	offlineNote,
	decodeOrder,
	deckOrderChoices,
	deckOrderControl,
	encodeOrder,
	noPackHint,
	rankingPack,
	resolveAvailableOrder,
	sessionOrderChoices
} from './newOrderView';

const jiten: FrequencyPack = {
	id: 3,
	packId: 'jiten-frequency',
	name: 'Jiten frequency list',
	version: '1',
	language: 'ja',
	license: 'CC BY-SA 4.0',
	attribution: 'Jiten'
};
const zhPack: FrequencyPack = {
	...jiten,
	id: 4,
	packId: 'local-zh',
	name: 'Local zh list',
	language: 'zh'
};
const hskWords = {
	id: 1,
	name: 'HSK 3.0 (words)',
	unit: 'word',
	language: 'zh',
	packId: 'hsk-words',
	levels: []
} as Scheme;
const jlptKanji = {
	id: 2,
	name: 'JLPT kanji',
	unit: 'character',
	language: 'ja',
	packId: 'jlpt-kanji',
	levels: []
} as Scheme;
const jlptWords = {
	id: 5,
	name: 'JLPT words',
	unit: 'word',
	language: 'ja',
	packId: 'jlpt-words',
	levels: []
} as Scheme;

describe('encode and decode', () => {
	it('round-trips every order', () => {
		for (const o of [
			'deck',
			{ by: 'added' },
			{ by: 'frequency' },
			{ by: 'level', packId: 'hsk-words' }
		] as const) {
			expect(decodeOrder(encodeOrder(o))).toEqual(o);
		}
		expect(decodeOrder('nonsense')).toBe('deck');
		expect(decodeOrder('level:')).toBe('deck');
	});
});

describe('rankingPack', () => {
	it('is the first pack of the language in priority order', () => {
		expect(rankingPack([zhPack, jiten, { ...jiten, id: 9 }], 'ja')?.id).toBe(3);
		expect(rankingPack([zhPack], 'ja')).toBeNull();
		expect(rankingPack([jiten], 'JA')?.id).toBe(3);
	});
});

describe('sessionOrderChoices', () => {
	it('decks mode with a pack and schemes', () => {
		const { choices, hint } = sessionOrderChoices({
			mode: 'decks',
			language: 'ja',
			packs: [jiten],
			schemes: [jlptKanji, hskWords, jlptWords]
		});
		expect(choices).toEqual([
			{ value: 'deck', label: 'As each deck is set' },
			{ value: 'added', label: 'In the order added' },
			{ value: 'frequency', label: 'Most frequent first (Jiten frequency list)' },
			{ value: 'level:jlpt-kanji', label: 'By level: JLPT kanji' },
			{ value: 'level:jlpt-words', label: 'By level: JLPT words' }
		]);
		expect(hint).toBeNull();
	});

	it('no pack: no frequency choice and the hint', () => {
		const { choices, hint } = sessionOrderChoices({
			mode: 'decks',
			language: 'ja',
			packs: [zhPack],
			schemes: []
		});
		expect(choices.map((c) => c.value)).toEqual(['deck', 'added']);
		expect(hint).toBe(
			'No frequency list is installed for Japanese. An administrator can add one in Settings, Data; see Data and licences.'
		);
		expect(noPackHint('zh')).toContain('for Chinese.');
	});

	it('levels mode: level order, and most frequent first only for a word scheme', () => {
		expect(
			sessionOrderChoices({
				mode: 'levels',
				language: 'ja',
				packs: [jiten],
				schemes: [],
				levelScheme: jlptWords
			}).choices
		).toEqual([
			{ value: 'deck', label: 'Level order' },
			{ value: 'frequency', label: 'Most frequent first (Jiten frequency list)' }
		]);
		const kanji = sessionOrderChoices({
			mode: 'levels',
			language: 'ja',
			packs: [jiten],
			schemes: [],
			levelScheme: jlptKanji
		});
		expect(kanji.choices).toEqual([{ value: 'deck', label: 'Level order' }]);
		expect(kanji.hint).toBeNull();
		const none = sessionOrderChoices({
			mode: 'levels',
			language: 'ja',
			packs: [],
			schemes: [],
			levelScheme: jlptWords
		});
		expect(none.choices.map((c) => c.value)).toEqual(['deck']);
		expect(none.hint).toContain('No frequency list is installed for Japanese.');
	});
});

describe('deckOrderChoices', () => {
	it('offers added, frequency and each scheme of the language', () => {
		const { choices, hint } = deckOrderChoices({
			language: 'zh',
			packs: [jiten, zhPack],
			schemes: [hskWords, jlptKanji]
		});
		expect(choices).toEqual([
			{ value: 'added', label: 'In the order added' },
			{ value: 'frequency', label: 'Most frequent first (Local zh list)' },
			{ value: 'level:hsk-words', label: 'By level: HSK 3.0 (words)' }
		]);
		expect(hint).toBeNull();
		const bare = deckOrderChoices({ language: 'zh', packs: [jiten], schemes: [] });
		expect(bare.choices.map((c) => c.value)).toEqual(['added']);
		expect(bare.hint).toContain('for Chinese.');
	});
});

describe('resolveAvailableOrder', () => {
	const env = { language: 'ja', packs: [jiten], schemes: [jlptWords] };
	it('keeps an order that can run', () => {
		expect(resolveAvailableOrder({ by: 'frequency' }, env)).toEqual({
			order: { by: 'frequency' },
			note: null
		});
		expect(resolveAvailableOrder({ by: 'level', packId: 'jlpt-words' }, env)).toEqual({
			order: { by: 'level', packId: 'jlpt-words' },
			note: null
		});
		expect(resolveAvailableOrder({ by: 'added' }, env)).toEqual({
			order: { by: 'added' },
			note: null
		});
	});
	it('a stored frequency order without a pack behaves as added and says so', () => {
		expect(resolveAvailableOrder({ by: 'frequency' }, { ...env, packs: [] })).toEqual({
			order: { by: 'added' },
			note: 'No frequency list is installed for Japanese; using the order added.'
		});
	});
	it('a level order whose scheme is gone behaves as added and says so', () => {
		expect(resolveAvailableOrder({ by: 'level', packId: 'hsk-words' }, env)).toEqual({
			order: { by: 'added' },
			note: 'The level list of this order is not installed; using the order added.'
		});
	});
	it('notes', () => {
		expect(mixedNote()).toBe('Your decks use different orders: in the order added.');
		expect(offlineNote()).toBe('Frequency order needs a connection; using the order added.');
	});
});

describe('deckOrderControl', () => {
	const env = { language: 'ja', packs: [jiten], schemes: [jlptWords] };
	it('is disabled and keeps the stored order while the lists load', () => {
		const c = deckOrderControl({ stored: { by: 'frequency' }, env: null, failed: false });
		expect(c.disabled).toBe(true);
		expect(c.value).toBe('frequency');
		expect(c.choices).toEqual([{ value: 'frequency', label: 'Most frequent first', disabled: true }]);
		expect(c.hint).toBeNull();
	});
	it('offers the choices once loaded', () => {
		const c = deckOrderControl({ stored: null, env, failed: false });
		expect(c.disabled).toBe(false);
		expect(c.value).toBe('added');
		expect(c.choices.map((x) => x.value)).toEqual(['added', 'frequency', 'level:jlpt-words']);
	});
	it('shows a stored order that cannot run as a disabled choice, selected', () => {
		const c = deckOrderControl({ stored: { by: 'frequency' }, env: { ...env, packs: [] }, failed: false });
		expect(c.value).toBe('frequency');
		expect(c.disabled).toBe(false);
		expect(c.choices[c.choices.length - 1]).toEqual({
			value: 'frequency',
			label: 'Most frequent first (not available)',
			disabled: true
		});
		const lvl = deckOrderControl({ stored: { by: 'level', packId: 'hsk-words' }, env, failed: false });
		expect(lvl.value).toBe('level:hsk-words');
		expect(lvl.choices.at(-1)).toEqual({ value: 'level:hsk-words', label: 'By level: hsk-words (not available)', disabled: true });
	});
	it('stays disabled when a list failed to load', () => {
		const c = deckOrderControl({ stored: null, env, failed: true });
		expect(c.disabled).toBe(true);
		expect(c.hint).toBe('Could not load the order choices. Try again later.');
	});
});
