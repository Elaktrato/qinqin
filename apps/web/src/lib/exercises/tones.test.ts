import { describe, expect, it } from 'vitest';
import {
	checkTones,
	cleanReadings,
	eligibleForTone,
	markedSyllable,
	parsePinyin,
	pinyinReadings,
	tonePadLabels,
	toneVerdict,
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
		const decomposed = 'xue\u0301 xi\u0301';
		const precomposed = 'xu\u00e9 x\u00ed';
		expect(decomposed).not.toBe(precomposed);
		expect(decomposed.length).toBeGreaterThan(precomposed.length);
		expect(parsePinyin(decomposed)).toEqual(parsePinyin(precomposed));
		expect(parsePinyin(decomposed)[0].text).toBe('xu\u00e9');
		expect(parsePinyin('nu\u0308\u030c')).toEqual(parsePinyin('n\u01da'));
		expect(parsePinyin('lu\u0308\u0300')).toEqual([{ text: 'l\u01dc', plain: 'l\u00fc', tone: 4 }]);
		expect(parsePinyin('lu\u0308\u0300')[0].text.normalize('NFC')).toBe('l\u01dc');
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
		expect(toneFromGesture(80, 0)).toBe(1);
		expect(toneFromGesture(-80, 0)).toBe(1);
		expect(toneFromGesture(80, -20)).toBe(1);
		expect(toneFromGesture(0, -80)).toBe(2);
		expect(toneFromGesture(5, -80)).toBe(2);
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
		expect(toneFromGesture(up)).toBe(2);
		const downRight = [
			{ x: 0, y: 0 },
			{ x: 30, y: 30 },
			{ x: 60, y: 60 }
		];
		expect(toneFromGesture(downRight)).toBe(4);
		expect(toneFromGesture([{ x: 5, y: 5 }])).toBe(5);
		expect(toneFromGesture([])).toBe(5);
	});

	it('classifies the left-hand sectors (documented choice)', () => {
		expect(toneFromGesture(-80, 0)).toBe(1); // left is flat
		expect(toneFromGesture(-60, -60)).toBe(2); // up-left rises
		expect(toneFromGesture(-60, 60)).toBe(4); // down-left
	});

	it('treats a swipe within 25 degrees of horizontal as flat, either way', () => {
		const flatRight = [
			{ x: 0, y: 0 },
			{ x: 40, y: 3 },
			{ x: 80, y: 5 }
		];
		const flatLeft = [
			{ x: 80, y: 0 },
			{ x: 40, y: -3 },
			{ x: 0, y: 4 }
		];
		expect(toneFromGesture(flatRight)).toBe(1);
		expect(toneFromGesture(flatLeft)).toBe(1);
		expect(toneFromGesture(80, -40)).toBe(2); // about 27 degrees
		expect(toneFromGesture(80, 40)).toBe(4);
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

describe('cleanReadings', () => {
	it('keeps letters-only readings and drops digits and punctuation', () => {
		expect(cleanReadings(['xué xí', 'xue2 xi2', 'qqq9', 'xué,', '', "nǚ'ér"])).toEqual([
			parsePinyin('xué xí'),
			parsePinyin("nǚ'ér")
		]);
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
		expect(eligibleForTone('zh', ['xue2 xi2'])).toBe(false);
		expect(eligibleForTone('zh', ['qqq9'])).toBe(false);
		expect(eligibleForTone('zh', ['xue2 xi2', 'xué xí'])).toBe(true);
	});
});

describe('pinyinReadings', () => {
	it('pinyinReadings keeps pinyin values only', () => {
		expect(
			pinyinReadings([
				{ type: 'pinyin', value: 'háng' },
				{ type: 'bopomofo', value: 'ㄏㄤˊ' },
				{ type: 'pinyin', value: 'xíng' }
			])
		).toEqual(['háng', 'xíng']);
	});
});

describe('toneVerdict', () => {
	it('marks each syllable against the best matching reading', () => {
		const candidates = [parsePinyin('xué xí')];
		expect(toneVerdict([2, 2], candidates)).toEqual({
			correct: true,
			wrong: 0,
			marks: [true, true],
			best: candidates[0],
			spoken: [2, 2]
		});
		const verdict = toneVerdict([2, 4], candidates);
		expect(verdict.wrong).toBe(1);
		expect(verdict.marks).toEqual([true, false]);
	});

	it('accepts any reading of a polyphone with the same length', () => {
		const candidates = [parsePinyin('háng'), parsePinyin('xíng')];
		expect(toneVerdict([2], candidates).correct).toBe(true);
		const both = [parsePinyin('zhǎng'), parsePinyin('cháng')];
		const verdict = toneVerdict([2], both);
		expect(verdict.correct).toBe(true);
		expect(verdict.best?.[0].text).toBe('cháng');
	});

	it('marks everything wrong when no reading has the same length', () => {
		const verdict = toneVerdict([1, 1], [parsePinyin('hǎo')]);
		expect(verdict).toEqual({ correct: false, wrong: 2, marks: [false, false], best: null, spoken: null });
	});
});

describe('toneVerdict and tone sandhi (#300)', () => {
	const buKeQi = [parsePinyin('bù kè qi')];
	const chars = ['不', '客', '气'];

	it('不客气 accepts 4-4-5 and 2-4-5 by default, only 2-4-5 when spoken tones are graded', () => {
		expect(toneVerdict([4, 4, 5], buKeQi, { chars }).correct).toBe(true);
		expect(toneVerdict([2, 4, 5], buKeQi, { chars }).correct).toBe(true);
		expect(toneVerdict([2, 4, 5], buKeQi, { chars, gradeSpoken: true }).correct).toBe(true);
		const citation = toneVerdict([4, 4, 5], buKeQi, { chars, gradeSpoken: true });
		expect(citation.correct).toBe(false);
		expect(citation.marks).toEqual([false, true, true]);
	});

	it('the answer it reports is the citation reading with its spoken tones (the "1-1-5" report)', () => {
		const verdict = toneVerdict([1, 1, 5], buKeQi, { chars });
		expect(verdict.best?.map((s) => [s.text, s.tone])).toEqual([
			['bù', 4],
			['kè', 4],
			['qi', 5]
		]);
		expect(verdict.spoken).toEqual([2, 4, 5]);
		expect(verdict.marks).toEqual([false, false, true]);
	});

	it('without characters 不 is not recognised, 3-3 still is', () => {
		expect(toneVerdict([2, 4, 5], buKeQi).correct).toBe(false);
		expect(toneVerdict([2, 3], [parsePinyin('nǐ hǎo')]).correct).toBe(true);
	});

	it('characters of another length are ignored', () => {
		expect(toneVerdict([2, 4, 5], buKeQi, { chars: ['不', '客'] }).correct).toBe(false);
	});
});

describe('markedSyllable', () => {
	it('puts the tone mark on the right vowel', () => {
		expect(markedSyllable('bu', 2)).toBe('bú');
		expect(markedSyllable('yi', 4)).toBe('yì');
		expect(markedSyllable('hao', 2)).toBe('háo');
		expect(markedSyllable('qi', 5)).toBe('qi');
		expect(markedSyllable('lü', 4)).toBe('lǜ');
	});
});

describe('tonePadLabels', () => {
	it('gives one Han character per syllable', () => {
		expect(tonePadLabels('学生', 2)).toEqual(['学', '生']);
	});

	it('falls back for erhua, where characters outnumber syllables', () => {
		expect(tonePadLabels('花儿', 1)).toBeNull();
	});

	it('falls back when a character is not Han', () => {
		expect(tonePadLabels('T恤', 2)).toBeNull();
	});
});
