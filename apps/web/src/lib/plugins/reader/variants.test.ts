import { describe, expect, it } from 'vitest';
import { convertText } from './variants';

describe('convertText', () => {
	it('converts simplified to traditional', () => {
		expect(convertText('汉语', 'traditional')).toBe('漢語');
	});

	it('converts traditional to simplified', () => {
		expect(convertText('漢語', 'simplified')).toBe('汉语');
	});

	it('leaves the original text unchanged', () => {
		expect(convertText('汉语 漢語', 'original')).toBe('汉语 漢語');
	});

	it('keeps text that has nothing to convert', () => {
		expect(convertText('abc 123', 'traditional')).toBe('abc 123');
		expect(convertText('', 'simplified')).toBe('');
	});
});
