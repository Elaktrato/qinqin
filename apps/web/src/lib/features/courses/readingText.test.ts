import { describe, expect, it } from 'vitest';
import type { SegmentMatch } from '$lib/api/types';
import { readingParts, unreachedEntries } from './readingText';

const m = (surface: string, start: number, id: number, reading?: { type: string; value: string }): SegmentMatch => ({
	surface,
	start,
	end: start + [...surface].length,
	lemma: surface,
	reason: '',
	entries: [{ id, kind: 'word' }],
	...(reading ? { reading } : {})
});

describe('the reading lesson text (#222, Ruling 23)', () => {
	const text = '你好！谢谢！';
	const matches = [m('你好', 0, 101, { type: 'pinyin', value: 'nǐ hǎo' }), m('谢谢', 3, 102, { type: 'pinyin', value: 'xiè xie' })];

	it('cuts the text into plain runs and words, with a reading on the words the learner has not reached', () => {
		expect(readingParts(text, matches, new Set([101]))).toEqual([
			{ text: '你好', entryId: 101, reading: null },
			{ text: '！', entryId: null, reading: null },
			{ text: '谢谢', entryId: 102, reading: { type: 'pinyin', value: 'xiè xie' } },
			{ text: '！', entryId: null, reading: null }
		]);
	});

	it('counts by code points, skips overlapping or out-of-range matches, and keeps the whole text', () => {
		const astral = '𠀋好';
		const parts = readingParts(astral, [m('好', 1, 7, { type: 'pinyin', value: 'hǎo' }), m('x', 9, 9)], new Set());
		expect(parts.map((p) => p.text).join('')).toBe(astral);
		expect(parts).toEqual([
			{ text: '𠀋', entryId: null, reading: null },
			{ text: '好', entryId: 7, reading: { type: 'pinyin', value: 'hǎo' } }
		]);
		// A match inside one already taken is left out.
		expect(readingParts(astral, [m('好', 1, 7), m('𠀋好', 0, 8)], new Set())).toEqual([{ text: '𠀋好', entryId: 8, reading: null }]);
	});

	it('unreachedEntries: the entries of the unreached words, once, in text order', () => {
		const parts = readingParts('谢谢你好谢谢', [m('谢谢', 0, 102, { type: 'pinyin', value: 'x' }), m('你好', 2, 101, { type: 'pinyin', value: 'n' }), m('谢谢', 4, 102, { type: 'pinyin', value: 'x' })], new Set([101]));
		expect(unreachedEntries(parts)).toEqual([{ entryId: 102, text: '谢谢', reading: { type: 'pinyin', value: 'x' } }]);
	});
});
