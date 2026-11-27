import { describe, expect, it } from 'vitest';

import type { Entry } from '$lib/api/types';
import {
	acceptedReverseAnswers,
	buildReverseFront,
	suggestReverseGrade
} from './reverse';

function sense(gloss: string, dictionaryName = 'CC-CEDICT') {
	return { dictionaryId: 1, dictionaryName, packId: 'p', license: 'l', attribution: 'a', gloss };
}

function entry(extra: Partial<Entry> = {}): Entry {
	return {
		id: 1,
		kind: 'word',
		language: 'zh',
		written: '喜欢',
		readings: [{ type: 'pinyin', value: 'xi3 huan5' }],
		senses: [sense('to like'), sense('to be fond of')],
		variants: [],
		sentences: [],
		badges: [],
		...extra
	} as unknown as Entry;
}

describe('buildReverseFront', () => {
	it('uses the first sense group: its pos and at most three glosses', () => {
		const front = buildReverseFront(
			entry({
				senseGroups: [
					{ pos: ['verb'], glosses: ['a', 'b', 'c', 'd'] },
					{ pos: ['noun'], glosses: ['z'] }
				] as unknown as Entry['senseGroups']
			})
		);
		expect(front).toEqual({ pos: ['verb'], glosses: ['a', 'b', 'c'] });
	});

	it('falls back to the flat senses, capped at three', () => {
		const front = buildReverseFront(
			entry({ senses: [sense('1'), sense('2'), sense('3'), sense('4')] })
		);
		expect(front).toEqual({ pos: [], glosses: ['1', '2', '3'] });
	});

	it('never contains the written form', () => {
		const front = buildReverseFront(entry());
		expect(JSON.stringify(front)).not.toContain('喜欢');
	});
});

describe('acceptedReverseAnswers', () => {
	it('accepts the written form, forms and variants, normalised', () => {
		const accepted = acceptedReverseAnswers({
			written: '食べる',
			forms: [{ text: '食べます', flags: [] }],
			variants: [{ written: '喰べる' }] as unknown as Entry['variants']
		});
		expect([...accepted].sort()).toEqual(['喰べる', '食べます', '食べる'].sort());
		expect(accepted.has(' 食 べる '.replace(/\s/g, ''))).toBe(true);
	});
});

describe('suggestReverseGrade', () => {
	const accepted = new Set(['喜欢']);
	it('is null for nothing typed', () => {
		expect(suggestReverseGrade({ typed: '', accepted })).toBeNull();
		expect(suggestReverseGrade({ typed: '  　', accepted })).toBeNull();
	});
	it('is Good when right and Again when wrong (a hint lowers it later, hints.ts)', () => {
		expect(suggestReverseGrade({ typed: ' 喜 欢 ', accepted })).toBe(3);
		expect(suggestReverseGrade({ typed: '高兴', accepted })).toBe(1);
	});
});

describe('typed answers with symbols', () => {
	it('keeps symbols and stays gradable for a symbol-only answer', () => {
		const e = entry({ written: 'C++', forms: [], variants: [] });
		const accepted = acceptedReverseAnswers(e);
		expect(suggestReverseGrade({ typed: 'C++', accepted })).toBe(3);
		expect(suggestReverseGrade({ typed: 'C', accepted })).toBe(1);
		const plus = acceptedReverseAnswers(entry({ written: '+' }));
		expect(suggestReverseGrade({ typed: '＋', accepted: plus })).toBe(3);
		expect(suggestReverseGrade({ typed: '$5', accepted: acceptedReverseAnswers(entry({ written: '5' })) })).toBe(1);
	});
});
