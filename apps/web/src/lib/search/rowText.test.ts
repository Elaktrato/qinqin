import { describe, expect, it } from 'vitest';
import type { SearchHit } from '$lib/api/types';
import { firstGloss, kindLevel } from './rowText';

function hit(over: Partial<SearchHit> = {}): SearchHit {
	return {
		id: 1,
		language: 'zh',
		kind: 'word',
		written: '勤奋',
		readings: [],
		attrs: {},
		radicalId: null,
		source: 'written',
		glosses: [
			{ dictionaryId: 1, gloss: 'diligent' },
			{ dictionaryId: 2, gloss: 'hard-working' }
		],
		levels: [{ scheme: 'HSK', level: '5' }],
		...over
	};
}

describe('rowText (#104)', () => {
	it('firstGloss skips hidden dictionaries and returns "" when all are hidden', () => {
		expect(firstGloss(hit(), new Set())).toBe('diligent');
		expect(firstGloss(hit(), new Set([1]))).toBe('hard-working');
		expect(firstGloss(hit(), new Set([1, 2]))).toBe('');
		expect(firstGloss(hit({ glosses: [] }), new Set())).toBe('');
	});

	it('kindLevel says "Word · HSK 5", "Character" without a level', () => {
		expect(kindLevel(hit())).toBe('Word · HSK 5');
		expect(kindLevel(hit({ kind: 'character' }))).toBe('Character · HSK 5');
		expect(kindLevel(hit({ levels: [] }))).toBe('Word');
	});
});
