import { describe, expect, it } from 'vitest';
import { formatReading } from './format';

describe('formatReading', () => {
	it('labels pinyin and keeps the tone marks', () => {
		expect(formatReading('pinyin', 'hàn')).toBe('Pinyin: hàn');
	});

	it('labels bopomofo', () => {
		expect(formatReading('bopomofo', 'ㄏㄢˋ')).toBe('Bopomofo: ㄏㄢˋ');
	});

	it('labels kana', () => {
		expect(formatReading('kana', 'かん')).toBe('Kana: かん');
	});

	it('labels romaji', () => {
		expect(formatReading('romaji', 'kan')).toBe('Romaji: kan');
	});

	it('labels on and kun readings', () => {
		expect(formatReading('on', 'カン')).toBe('On: カン');
		expect(formatReading('kun', 'かん')).toBe('Kun: かん');
	});

	it('returns unknown reading types unchanged', () => {
		expect(formatReading('jyutping', 'hòn')).toBe('hòn');
	});

	it('normalizes the case and whitespace of known types', () => {
		expect(formatReading(' PINYIN ', 'hǎo')).toBe('Pinyin: hǎo');
	});
});
