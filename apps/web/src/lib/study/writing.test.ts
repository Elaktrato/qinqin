import { describe, expect, it } from 'vitest';
import {
	isHan,
	quizOptions,
	suggestWritingGrade,
	usableChars,
	writableChars,
	type CharOutcome
} from './writing';

const o = (mistakes: number, strokes: number, revealed = false): CharOutcome => ({
	char: '学',
	mistakes,
	strokes,
	revealed
});

describe('isHan / writableChars', () => {
	it('detects Han only', () => {
		expect(isHan('学')).toBe(true);
		expect(isHan('𠀀')).toBe(true);
		expect(isHan('あ')).toBe(false);
		expect(isHan('a')).toBe(false);
		expect(isHan('')).toBe(false);
	});
	it('keeps distinct Han characters in first-appearance order', () => {
		expect(writableChars('学习学a、あ生')).toEqual(['学', '习', '生']);
		expect(writableChars('𠀀好𠀀')).toEqual(['𠀀', '好']);
		expect(writableChars('')).toEqual([]);
	});
});

describe('suggestWritingGrade', () => {
	it('3 with no mistakes and no reveal', () => {
		expect(suggestWritingGrade([o(0, 8), o(0, 5)])).toBe(3);
	});
	it('1 on any reveal, even without mistakes', () => {
		expect(suggestWritingGrade([o(0, 8), o(0, 5, true)])).toBe(1);
	});
	it('2 up to and including 25% mistakes of total strokes', () => {
		expect(suggestWritingGrade([o(1, 4)])).toBe(2);
		expect(suggestWritingGrade([o(1, 4), o(1, 4)])).toBe(2);
	});
	it('1 above 25%', () => {
		expect(suggestWritingGrade([o(2, 7)])).toBe(1);
	});
	it('empty outcomes give 1', () => {
		expect(suggestWritingGrade([])).toBe(1);
	});
});

describe('usableChars', () => {
	it('drops characters without stroke data', async () => {
		const load = async (ch: string) => (ch === '习' ? null : {});
		expect(await usableChars('学习生a', load)).toEqual(['学', '生']);
	});
});

describe('quizOptions', () => {
	it('hints after 3 misses', () => {
		const q = quizOptions();
		expect(q.showHintAfterMisses).toBe(3);
		expect(q.leniency).toBeGreaterThan(0);
		expect(q.drawingWidth).toBeGreaterThan(0);
	});
});
