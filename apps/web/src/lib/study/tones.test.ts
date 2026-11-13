import { describe, expect, it } from 'vitest';
import {
	checkTones,
	eligibleForTone,
	parsePinyin,
	suggestToneGrade,
	toneFromGesture,
	type Syllable
} from './tones';

const tones = (value: string) => parsePinyin(value).map((s) => s.tone);
const plains = (value: string) => parsePinyin(value).map((s) => s.plain);

describe('parsePinyin', () => {
	it('splits space separated words and reads the marks', () => {
		expect(parsePinyin('xué xí')).toEqual([
			{ text: 'xué', plain: 'xue', tone: 2 },
			{ text: 'xí', plain: 'xi', tone: 2 }
		]);
		expect(tones('zhōng guó')).toEqual([1, 2]);
		expect(plains('zhōng guó')).toEqual(['zhong', 'guo']);
	});

	it('splits at apostrophes and handles ü', () => {
		expect(parsePinyin("nǚ'ér")).toEqual([
			{ text: 'nǚ', plain: 'nü', tone: 3 },
			{ text: 'ér', plain: 'er', tone: 2 }
		]);
		expect(parsePinyin('lǜ')).toEqual([{ text: 'lǜ', plain: 'lü', tone: 4 }]);
		expect(tones('nǚ’ér')).toEqual([3, 2]);
	});

	it('treats v as ü', () => {
		expect(parsePinyin('lv')).toEqual([{ text: 'lü', plain: 'lü', tone: 5 }]);
	});

	it('reads all four marks on every vowel, precomposed or decomposed', () => {
		expect(tones('mā má mǎ mà')).toEqual([1, 2, 3, 4]);
		expect(tones('dū dú dǔ dù')).toEqual([1, 2, 3, 4]);
		expect(tones('ǖ ǘ ǚ ǜ')).toEqual([1, 2, 3, 4]);
		expect(tones('hǎo liú guī')).toEqual([3, 2, 1]);
		expect(parsePinyin('xué xí')).toEqual(parsePinyin('xué xí'));
		expect(parsePinyin('nǚ')).toEqual(parsePinyin('nǚ'));
		expect(parsePinyin('xué')[0].text).toBe('xué');
	});

	it('marks without a tone mark are neutral', () => {
		expect(parsePinyin('ma')).toEqual([{ text: 'ma', plain: 'ma', tone: 5 }]);
		expect(tones('xiè xie')).toEqual([4, 5]);
	});

	it('keeps erhua in the previous syllable', () => {
		expect(parsePinyin('huār')).toEqual([{ text: 'huār', plain: 'huar', tone: 1 }]);
		expect(parsePinyin('huā r')).toEqual([{ text: 'huār', plain: 'huar', tone: 1 }]);
		expect(parsePinyin("huā'r")).toEqual([{ text: 'huār', plain: 'huar', tone: 1 }]);
		expect(parsePinyin('yī diǎnr')).toHaveLength(2);
		expect(tones('yī diǎnr')).toEqual([1, 3]);
	});

	it('does not fold a real syllable er', () => {
		expect(parsePinyin('ér zi')).toHaveLength(2);
		expect(tones('ér')).toEqual([2]);
	});

	it('normalises case and whitespace', () => {
		expect(parsePinyin('  XUÉ   Xí \t')).toEqual(parsePinyin('xué xí'));
		expect(parsePinyin('')).toEqual([]);
		expect(parsePinyin('   ')).toEqual([]);
	});
});

describe('toneFromGesture', () => {
	it('is neutral for a tap or tiny movement', () => {
		expect(toneFromGesture(0, 0)).toBe(5);
		expect(toneFromGesture(3, -4)).toBe(5);
		expect(toneFromGesture(0, -30, 50)).toBe(5);
	});

	it('maps directions in screen coordinates (y grows downward)', () => {
		expect(toneFromGesture(0, -80)).toBe(1);
		expect(toneFromGesture(5, -80)).toBe(1);
		expect(toneFromGesture(60, -60)).toBe(2);
		expect(toneFromGesture(60, 60)).toBe(4);
		expect(toneFromGesture(0, 80)).toBe(4);
	});

	it('accepts a path and detects the dip', () => {
		const dip = [
			{ x: 0, y: 0 },
			{ x: 20, y: 40 },
			{ x: 40, y: 0 }
		];
		expect(toneFromGesture(dip)).toBe(3);
		const dipEndingHigher = [
			{ x: 0, y: 0 },
			{ x: 15, y: 40 },
			{ x: 40, y: -20 }
		];
		expect(toneFromGesture(dipEndingHigher)).toBe(3);
	});

	it('falls back to the vector for a path without a dip', () => {
		const up = [
			{ x: 0, y: 0 },
			{ x: 1, y: -40 },
			{ x: 2, y: -80 }
		];
		expect(toneFromGesture(up)).toBe(1);
		const downRight = [
			{ x: 0, y: 0 },
			{ x: 30, y: 30 },
			{ x: 60, y: 60 }
		];
		expect(toneFromGesture(downRight)).toBe(4);
		expect(toneFromGesture([{ x: 5, y: 5 }])).toBe(5);
		expect(toneFromGesture([])).toBe(5);
	});

	it('ignores a small wobble in a tap path', () => {
		const wobble = [
			{ x: 0, y: 0 },
			{ x: 1, y: 4 },
			{ x: 2, y: 0 }
		];
		expect(toneFromGesture(wobble)).toBe(5);
	});
});

describe('checkTones', () => {
	const s = (value: string): Syllable[] => parsePinyin(value);

	it('checks a single candidate', () => {
		expect(checkTones([2, 2], [s('xué xí')])).toEqual({ correct: true, wrong: 0 });
		expect(checkTones([2, 4], [s('xué xí')])).toEqual({ correct: false, wrong: 1 });
		expect(checkTones([1, 4], [s('xué xí')])).toEqual({ correct: false, wrong: 2 });
	});

	it('accepts any polyphone candidate and picks the best', () => {
		const candidates = [s('háng'), s('xíng')];
		expect(checkTones([2], candidates).correct).toBe(true);
		const words = [s('yín háng'), s('yín xíng'), s('yín hàng')];
		expect(checkTones([2, 4], words)).toEqual({ correct: true, wrong: 0 });
		expect(checkTones([1, 4], words)).toEqual({ correct: false, wrong: 1 });
	});

	it('ignores candidates with another syllable count', () => {
		expect(checkTones([2, 2], [s('xué')])).toEqual({ correct: false, wrong: 2 });
		expect(checkTones([2], [s('xué xí'), s('xué')])).toEqual({ correct: true, wrong: 0 });
		expect(checkTones([2, 2], [])).toEqual({ correct: false, wrong: 2 });
	});
});

describe('suggestToneGrade', () => {
	it('maps wrong counts to grades', () => {
		expect(suggestToneGrade(0)).toBe(3);
		expect(suggestToneGrade(1)).toBe(2);
		expect(suggestToneGrade(2)).toBe(1);
		expect(suggestToneGrade(5)).toBe(1);
	});
});

describe('eligibleForTone', () => {
	it('is true for Chinese with a reading', () => {
		expect(eligibleForTone('zh', ['xué xí'])).toBe(true);
		expect(eligibleForTone('zh-CN', ['', 'xué'])).toBe(true);
	});

	it('is false for Japanese, other languages and empty readings', () => {
		expect(eligibleForTone('ja', ['がくしゅう'])).toBe(false);
		expect(eligibleForTone('en', ['xué'])).toBe(false);
		expect(eligibleForTone('zh', [])).toBe(false);
		expect(eligibleForTone('zh', ['', '  '])).toBe(false);
	});
});
