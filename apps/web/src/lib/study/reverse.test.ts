import { describe, expect, it } from 'vitest';

import type { Entry } from '../api/types';
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
		expect(suggestReverseGrade({ typed: '', accepted, readingShown: false })).toBeNull();
		expect(suggestReverseGrade({ typed: '  　', accepted, readingShown: false })).toBeNull();
	});
	it('is Good, Hard with the reading shown, and Again when wrong', () => {
		expect(suggestReverseGrade({ typed: ' 喜 欢 ', accepted, readingShown: false })).toBe(3);
		expect(suggestReverseGrade({ typed: '喜欢', accepted, readingShown: true })).toBe(2);
		expect(suggestReverseGrade({ typed: '高兴', accepted, readingShown: false })).toBe(1);
	});
});
