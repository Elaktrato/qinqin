import { describe, expect, it } from 'vitest';
import type { SegmentMatch } from '$lib/api/types';
import type { KnownIndex } from '$lib/studycore/known';
import { isWordToken, wordRanges } from './wordRanges';

const m = (start: number, end: number, surface: string, ...entries: number[]): SegmentMatch => ({
	surface,
	start,
	end,
	lemma: surface,
	reason: '',
	entries: entries.map((id) => ({ id, kind: 'word' as const }))
});
const index = (o: { scores?: [number, number][]; carded?: number[]; marks?: number[] }): KnownIndex => ({
	scores: new Map(o.scores ?? []),
	carded: new Set(o.carded ?? []),
	marks: new Set(o.marks ?? [])
});

describe('isWordToken', () => {
	it('zh: Han, 々 and 〆 are word characters; punctuation, digits and Latin are not', () => {
		expect(isWordToken('你好', 'zh')).toBe(true);
		expect(isWordToken('三', 'zh')).toBe(true);
		expect(isWordToken('〆', 'zh')).toBe(true);
		expect(isWordToken('，', 'zh')).toBe(false);
		expect(isWordToken('2024', 'zh')).toBe(false);
		expect(isWordToken('２０', 'zh')).toBe(false);
		expect(isWordToken('CD', 'zh')).toBe(false);
		expect(isWordToken('の', 'zh')).toBe(false);
	});
	it('ja: kana too, but not a lone ー', () => {
		expect(isWordToken('は', 'ja')).toBe(true);
		expect(isWordToken('コーヒー', 'ja')).toBe(true);
		expect(isWordToken('ー', 'ja')).toBe(false);
		expect(isWordToken('ーー', 'ja')).toBe(false);
		expect(isWordToken('・', 'ja')).toBe(false);
	});
});

describe('wordRanges', () => {
	const matches = [m(0, 2, '你好', 1), m(2, 3, '，', 9), m(3, 5, '世界', 2), m(5, 6, '人', 3)];
	it('gives new and learning ranges, nothing for known words or non-tokens', () => {
		const got = wordRanges(matches, index({ scores: [[1, 90], [2, 40]], carded: [1, 2] }), 80, 'zh');
		expect(got).toEqual([
			{ start: 3, end: 5, state: 'learning' },
			{ start: 5, end: 6, state: 'new' }
		]);
	});
	it('uses the threshold it is given and the marks', () => {
		const got = wordRanges(matches, index({ scores: [[2, 40]], carded: [2], marks: [3] }), 40, 'zh');
		expect(got).toEqual([{ start: 0, end: 2, state: 'new' }]);
	});
	it('only the first candidate decides', () => {
		expect(wordRanges([m(0, 1, '了', 7, 8)], index({ marks: [8] }), 80, 'zh')).toEqual([{ start: 0, end: 1, state: 'new' }]);
	});
});
