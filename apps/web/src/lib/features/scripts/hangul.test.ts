import { describe, expect, it } from 'vitest';
import { composeSyllable, decompose, finalRoman, FINALS, INITIALS, MEDIALS, romanSyllable } from './hangul';

describe('hangul', () => {
	it('has 19 initials, 21 vowels and 27 finals', () => {
		expect(INITIALS).toHaveLength(19);
		expect(MEDIALS).toHaveLength(21);
		expect(FINALS).toHaveLength(27);
	});

	it('composes by the Unicode formula', () => {
		expect(composeSyllable('ㄱ', 'ㅏ')).toBe('가');
		expect(composeSyllable('ㅎ', 'ㅏ', 'ㄴ')).toBe('한');
		expect(composeSyllable('ㅎ', 'ㅏ', 'ㄱ')).toBe('학');
		expect(composeSyllable('ㅇ', 'ㅣ')).toBe('이');
		expect(composeSyllable('ㅎ', 'ㅣ', 'ㅎ')).toBe('힣');
	});

	it('decomposes a syllable and refuses other text', () => {
		expect(decompose('한')).toEqual({ initial: 'ㅎ', medial: 'ㅏ', final: 'ㄴ' });
		expect(decompose('가')).toEqual({ initial: 'ㄱ', medial: 'ㅏ', final: null });
		expect(decompose('a')).toBeNull();
		expect(decompose('ㄱ')).toBeNull();
		expect(decompose('가나')).toBeNull();
	});

	it('round-trips every block', () => {
		for (let code = 0xac00; code <= 0xd7a3; code += 97) {
			const ch = String.fromCodePoint(code);
			const p = decompose(ch)!;
			expect(composeSyllable(p.initial, p.medial, p.final)).toBe(ch);
		}
	});

	it('refuses a jamo that cannot take the place', () => {
		expect(() => composeSyllable('ㅏ', 'ㅏ')).toThrow();
		expect(() => composeSyllable('ㄱ', 'ㄱ')).toThrow();
		expect(() => composeSyllable('ㄱ', 'ㅏ', 'ㅃ')).toThrow();
	});

	it('romanises a single syllable (revised romanisation, no assimilation)', () => {
		expect(romanSyllable('가')).toBe('ga');
		expect(romanSyllable('한')).toBe('han');
		expect(romanSyllable('학')).toBe('hak');
		expect(romanSyllable('책')).toBe('chaek');
		expect(romanSyllable('물')).toBe('mul');
		expect(romanSyllable('이')).toBe('i');
		expect(romanSyllable('밥')).toBe('bap');
		expect(romanSyllable('강')).toBe('gang');
		expect(romanSyllable('x')).toBeNull();
	});

	it('names the sound of a final', () => {
		expect(finalRoman('ㄲ')).toBe('k');
		expect(finalRoman('ㅇ')).toBe('ng');
		expect(finalRoman('ㅅ')).toBe('t');
	});
});
