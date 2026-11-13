import { describe, expect, it } from 'vitest';
import {
	isCorrect,
	loadTokens,
	shuffleTokens,
	splitWithin,
	suggestSaladGrade,
	tierFor,
	tokenize
} from './wordSalad';

describe('tierFor', () => {
	it('maps stability to tiers', () => {
		expect(tierFor(null)).toBe(0);
		expect(tierFor(3.9)).toBe(0);
		expect(tierFor(4)).toBe(1);
		expect(tierFor(20.9)).toBe(1);
		expect(tierFor(21)).toBe(2);
	});
});

describe('tokenize', () => {
	it('uses matched spans and attaches trailing punctuation', () => {
		const spans = [
			{ start: 0, end: 2 },
			{ start: 2, end: 3 },
			{ start: 3, end: 5 }
		];
		expect(tokenize('ja', '宿題をした。', spans)).toEqual(['宿題', 'を', 'した。']);
	});

	it('splits uncovered gaps per character and drops whitespace', () => {
		expect(tokenize('zh', '我 爱你', [{ start: 2, end: 4 }])).toEqual(['我', '爱你']);
		expect(tokenize('zh', '我爱你', [])).toEqual(['我', '爱', '你']);
	});

	it('attaches full-width and ASCII punctuation to the previous token', () => {
		expect(tokenize('ja', '「行く」、そう！？', [])).toEqual(['「', '行', 'く」、', 'そ', 'う！？']);
		expect(tokenize('zh', '好.好!', [])).toEqual(['好.', '好!']);
		expect(tokenize('ja', '本当…', [])).toEqual(['本', '当…']);
	});

	it('splits other languages on whitespace keeping punctuation', () => {
		expect(tokenize('en', 'Hello,  big world.', [])).toEqual(['Hello,', 'big', 'world.']);
		expect(tokenize('en', 'Hello world', [{ start: 0, end: 3 }])).toEqual(['Hello', 'world']);
	});

	it('treats astral characters as one token', () => {
		expect(tokenize('zh', '𠮷野', [])).toEqual(['𠮷', '野']);
		expect(tokenize('zh', 'a𠮷。', [{ start: 1, end: 2 }])).toEqual(['a', '𠮷。']);
	});

	it('sanitises unsorted, overlapping and out-of-range spans', () => {
		const spans = [
			{ start: 2, end: 4 },
			{ start: 0, end: 2 },
			{ start: 1, end: 3 },
			{ start: -1, end: 2 },
			{ start: 3, end: 99 },
			{ start: 3, end: 3 },
			{ start: 1.5, end: 2 }
		];
		expect(tokenize('zh', '一二三四五', spans)).toEqual(['一二', '三四', '五']);
	});
});

describe('splitWithin', () => {
	it('splits into code points keeping punctuation attached', () => {
		expect(splitWithin(['宿題', 'した。', '𠮷野」'])).toEqual(['宿', '題', 'し', 'た。', '𠮷', '野」']);
		expect(splitWithin(['a'])).toEqual(['a']);
	});
});

describe('shuffleTokens', () => {
	const items = ['a', 'b', 'c', 'd', 'e', 'f'];

	it('is deterministic per seed and keeps the multiset', () => {
		const one = shuffleTokens(items, 'seed');
		expect(shuffleTokens(items, 'seed')).toEqual(one);
		expect([...one].sort()).toEqual(items);
		expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
	});

	it('never returns the identity order when another exists', () => {
		for (let i = 0; i < 200; i++) {
			expect(shuffleTokens(['x', 'y'], `s${i}`)).not.toEqual(['x', 'y']);
			expect(shuffleTokens(['x', 'y', 'z'], `s${i}`)).not.toEqual(['x', 'y', 'z']);
			expect(shuffleTokens(['x', 'x', 'y'], `s${i}`)).not.toEqual(['x', 'x', 'y']);
		}
	});

	it('handles trivial inputs', () => {
		expect(shuffleTokens([], 's')).toEqual([]);
		expect(shuffleTokens(['a'], 's')).toEqual(['a']);
		expect(shuffleTokens(['a', 'a'], 's')).toEqual(['a', 'a']);
	});

	it('varies across seeds', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 20; i++) seen.add(shuffleTokens(items, `k${i}`).join(''));
		expect(seen.size).toBeGreaterThan(5);
	});
});

describe('isCorrect', () => {
	it('compares in order', () => {
		expect(isCorrect(['a', 'b'], ['a', 'b'])).toBe(true);
		expect(isCorrect(['b', 'a'], ['a', 'b'])).toBe(false);
		expect(isCorrect(['a'], ['a', 'b'])).toBe(false);
	});
});

describe('suggestSaladGrade', () => {
	it('follows the table', () => {
		expect(suggestSaladGrade({ wrongChecks: 0, revealed: false })).toBe(3);
		expect(suggestSaladGrade({ wrongChecks: 1, revealed: false })).toBe(2);
		expect(suggestSaladGrade({ wrongChecks: 2, revealed: false })).toBe(2);
		expect(suggestSaladGrade({ wrongChecks: 3, revealed: false })).toBe(1);
		expect(suggestSaladGrade({ wrongChecks: 0, revealed: true })).toBe(1);
		expect(suggestSaladGrade({ wrongChecks: 1, revealed: true })).toBe(1);
	});
});

describe('loadTokens', () => {
	it('uses the injected segment function', async () => {
		const segment = async () => [
			{ start: 0, end: 2 },
			{ start: 2, end: 3 }
		];
		expect(await loadTokens('ja', '宿題を。', segment)).toEqual(['宿題', 'を。']);
	});

	it('falls back per character on error', async () => {
		const segment = async () => {
			throw new Error('boom');
		};
		expect(await loadTokens('ja', '宿題を。', segment)).toEqual(['宿', '題', 'を。']);
	});

	it('falls back on a synchronous throw and non-array results', async () => {
		const thrower = (() => {
			throw new Error('sync');
		}) as unknown as () => Promise<never[]>;
		expect(await loadTokens('zh', '你好', thrower)).toEqual(['你', '好']);
		const bad = (async () => null) as unknown as () => Promise<never[]>;
		expect(await loadTokens('zh', '你好', bad)).toEqual(['你', '好']);
	});

	it('sanitises overlapping and out-of-range spans', async () => {
		const segment = async () => [
			{ start: 0, end: 2 },
			{ start: 1, end: 3 },
			{ start: 2, end: 50 }
		];
		expect(await loadTokens('zh', '一二三', segment)).toEqual(['一二', '三']);
	});
});
