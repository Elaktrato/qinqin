import { describe, expect, it } from 'vitest';
import { checkPair, slotsOf, textOf } from './answer';
import type { PairWord } from './words';

const word = (written: string, ...values: string[]): PairWord => ({
	entryId: 1,
	written,
	language: 'zh',
	readings: values.map((value, ord) => ({ type: 'pinyin', value, plain: '', ord })),
	fromDeck: false
});

describe('the answer field and the tone buttons', () => {
	it('shows what is typed in the two slots', () => {
		expect(slotsOf('3 4')).toEqual([3, 4]);
		expect(slotsOf('3')).toEqual([3, null]);
		expect(slotsOf('? 4')).toEqual([null, 4]);
		expect(slotsOf('nǐ hǎo')).toEqual([3, 3]);
		expect(slotsOf('')).toEqual([null, null]);
		expect(slotsOf('3 9')).toEqual([3, null]);
		expect(slotsOf('1 0')).toEqual([1, 5]);
	});

	it('writes a button choice into the field, a placeholder for the slot still empty', () => {
		expect(textOf([3, 4])).toBe('3 4');
		expect(textOf([null, 4])).toBe('? 4');
		expect(textOf([2, null])).toBe('2 ?');
	});
});

describe('checkPair', () => {
	it('is no answer until two tones are typed', () => {
		expect(checkPair('3', word('你好', 'nǐ hǎo'), false)).toBeNull();
		expect(checkPair('2 ?', word('你好', 'nǐ hǎo'), false)).toBeNull();
	});

	it('grades the citation tones, accepts the spoken tone, Good or Again', () => {
		const right = checkPair('3 3', word('你好', 'nǐ hǎo'), false)!;
		expect(right.grade).toBe(3);
		expect(right.verdict.spoken).toEqual([2, 3]);
		expect(checkPair('2 3', word('你好', 'nǐ hǎo'), false)!.grade).toBe(3);
		const wrong = checkPair('3 4', word('你好', 'nǐ hǎo'), false)!;
		expect(wrong.grade).toBe(1);
		expect(wrong.verdict.marks).toEqual([true, false]);
	});

	it('with "Grade spoken tones" only the spoken tones are right', () => {
		expect(checkPair('3 3', word('你好', 'nǐ hǎo'), true)!.grade).toBe(1);
		expect(checkPair('2 3', word('你好', 'nǐ hǎo'), true)!.grade).toBe(3);
		// 不 before a 4th tone is spoken 2: the characters decide.
		expect(checkPair('2 4', word('不是', 'bù shì'), true)!.grade).toBe(3);
	});

	it('takes the answer as typed and reads pinyin', () => {
		expect(checkPair('ni3 hao3', word('你好', 'nǐ hǎo'), false)!.tones).toEqual([3, 3]);
	});
});
