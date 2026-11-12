import { describe, expect, it } from 'vitest';
import { displayRuns, locate, offsetFromRun, paragraphString, sliceCodePoints } from './paragraphText';

describe('displayRuns / paragraphString', () => {
	it('concatenates run texts and never includes ruby', () => {
		const runs = displayRuns(
			[{ text: '私は' }, { text: '漢字', ruby: 'かんじ' }, { text: 'を読む' }],
			'original'
		);
		expect(runs).toEqual([{ text: '私は' }, { text: '漢字', ruby: 'かんじ' }, { text: 'を読む' }]);
		expect(paragraphString(runs)).toBe('私は漢字を読む');
	});

	it('converts each run for a variant and keeps ruby untouched', () => {
		const runs = displayRuns([{ text: '我学' }, { text: '汉语', ruby: 'hànyǔ' }], 'traditional');
		expect(runs).toEqual([{ text: '我學' }, { text: '漢語', ruby: 'hànyǔ' }]);
		expect(paragraphString(runs)).toBe('我學漢語');
	});

	it('handles an empty paragraph', () => {
		expect(paragraphString(displayRuns([], 'original'))).toBe('');
	});
});

describe('offsetFromRun / locate', () => {
	// "a𠮷" (3 UTF-16 units, 2 code points), "漢字" with ruby, "𠮷b".
	const runs = [{ text: 'a𠮷' }, { text: '漢字', ruby: 'かんじ' }, { text: '𠮷b' }];

	it('maps a run-local UTF-16 offset to a paragraph code-point offset', () => {
		expect(offsetFromRun(runs, 0, 0)).toBe(0);
		expect(offsetFromRun(runs, 0, 1)).toBe(1);
		expect(offsetFromRun(runs, 0, 3)).toBe(2);
		expect(offsetFromRun(runs, 1, 0)).toBe(2);
		expect(offsetFromRun(runs, 1, 1)).toBe(3);
		expect(offsetFromRun(runs, 2, 2)).toBe(5);
		expect(offsetFromRun(runs, 2, 3)).toBe(6);
	});

	it('clamps out-of-range runs and offsets', () => {
		expect(offsetFromRun(runs, 0, 99)).toBe(2);
		expect(offsetFromRun(runs, 9, 0)).toBe(6);
		expect(offsetFromRun(runs, -1, 0)).toBe(0);
	});

	it('locates a code-point offset as a run and UTF-16 offset', () => {
		expect(locate(runs, 0)).toEqual({ runIndex: 0, utf16Offset: 0 });
		expect(locate(runs, 1)).toEqual({ runIndex: 0, utf16Offset: 1 });
		expect(locate(runs, 2)).toEqual({ runIndex: 1, utf16Offset: 0 });
		expect(locate(runs, 5)).toEqual({ runIndex: 2, utf16Offset: 2 });
		expect(locate(runs, 6)).toEqual({ runIndex: 2, utf16Offset: 3 });
	});

	it('round-trips through locate and offsetFromRun', () => {
		for (let cp = 0; cp <= 6; cp++) {
			const { runIndex, utf16Offset } = locate(runs, cp);
			expect(offsetFromRun(runs, runIndex, utf16Offset)).toBe(cp);
		}
	});

	it('uses the displayed (converted) run lengths', () => {
		// "後" is the traditional form of "后" and "髮" of "发": same length,
		// but a converter is free to change run lengths, so the mapping
		// must only ever look at the displayed runs.
		const shown = displayRuns([{ text: '头发' }, { text: '以后' }], 'traditional');
		expect(paragraphString(shown)).toBe('頭髮以後');
		expect(offsetFromRun(shown, 1, 1)).toBe(3);
		const longer = [{ text: '一二三' }, { text: 'x' }];
		expect(offsetFromRun(longer, 1, 0)).toBe(3);
		expect(locate(longer, 3)).toEqual({ runIndex: 1, utf16Offset: 0 });
	});

	it('locates the end of an empty paragraph', () => {
		expect(locate([], 0)).toEqual({ runIndex: 0, utf16Offset: 0 });
	});
});

describe('sliceCodePoints', () => {
	it('slices by code points, never splitting surrogate pairs', () => {
		expect(sliceCodePoints('a𠮷b', 1, 2)).toBe('𠮷');
		expect(sliceCodePoints('a𠮷b', 0, 3)).toBe('a𠮷b');
		expect(sliceCodePoints('a𠮷b', 2, 99)).toBe('b');
		expect(sliceCodePoints('a𠮷b', 2, 1)).toBe('');
	});
});
