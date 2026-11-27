import { describe, expect, it } from 'vitest';
import { hidesRomaji, practiceModes, ROMAJI_ANSWER_MODES } from './romaji';
import { MODES } from './types';

// Hidden romaji in the writing-system trainer (#284).
describe('the kana trainer with romaji hidden', () => {
	const hide = (type: string) => type !== 'romaji';
	const show = () => true;

	it('hides romaji for the kana only, and only when the switch says so', () => {
		expect([hidesRomaji('hiragana', hide), hidesRomaji('katakana', hide), hidesRomaji('hangul', hide), hidesRomaji('cyrillic', hide)]).toEqual([true, true, false, false]);
		expect(hidesRomaji('hiragana', show)).toBe(false);
	});

	it('offers no mode that answers by choosing a romaji', () => {
		expect([...ROMAJI_ANSWER_MODES]).toEqual(['recognise', 'read']);
		expect(practiceModes(MODES, true)).toEqual(['recall', 'type', 'write']);
		expect(practiceModes(MODES, false)).toEqual([...MODES]);
	});
});
