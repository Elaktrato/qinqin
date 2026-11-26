import { describe, expect, it } from 'vitest';
import { checkTyped, keySteps, normaliseTyped } from './typing';

describe('checkTyped', () => {
	it('accepts the glyph, ignoring spaces and case', () => {
		expect(checkTyped('あ', ['あ'])).toBe(true);
		expect(checkTyped(' あ ', ['あ'])).toBe(true);
		expect(checkTyped('д', ['Д', 'д'])).toBe(true);
		expect(checkTyped('Д', ['Д', 'д'])).toBe(true);
		expect(checkTyped('い', ['あ'])).toBe(false);
	});

	it('rejects an empty answer', () => {
		expect(checkTyped('', [''])).toBe(false);
		expect(checkTyped('   ', ['あ'])).toBe(false);
	});

	it('treats a compatibility jamo and the conjoining jamo as the same', () => {
		expect(checkTyped('ᄀ', ['ㄱ'])).toBe(true);
		expect(normaliseTyped('ㄱ')).toBe(normaliseTyped('ᄀ'));
	});

	it('does not let a longer text pass for a letter', () => {
		expect(checkTyped('あい', ['あ'])).toBe(false);
	});
});

describe('keySteps', () => {
	it('splits a multi-press key', () => {
		expect(keySteps('H, K')).toEqual(['H', 'K']);
		expect(keySteps('Shift+O')).toEqual(['Shift+O']);
		expect(keySteps(undefined)).toEqual([]);
	});
});
