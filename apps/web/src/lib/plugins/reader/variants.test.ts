import { beforeAll, describe, expect, it } from 'vitest';
import { convertText, prepareVariant } from './variants';

describe('convertText', () => {
	it('refuses a variant that was not prepared', () => {
		// Runs first: nothing is loaded yet in this module instance.
		expect(() => convertText('汉语', 'traditional')).toThrow(/not prepared/);
	});

	describe('once prepared', () => {
		beforeAll(async () => {
			await Promise.all([prepareVariant('traditional'), prepareVariant('simplified')]);
		});

		it('converts simplified to traditional', () => {
			expect(convertText('汉语', 'traditional')).toBe('漢語');
		});

		it('converts traditional to simplified', () => {
			expect(convertText('漢語', 'simplified')).toBe('汉语');
		});

		it('keeps text that has nothing to convert', () => {
			expect(convertText('abc 123', 'traditional')).toBe('abc 123');
			expect(convertText('', 'simplified')).toBe('');
		});
	});

	it('leaves the original text unchanged without loading anything', async () => {
		await expect(prepareVariant('original')).resolves.toBeUndefined();
		expect(convertText('汉语 漢語', 'original')).toBe('汉语 漢語');
	});
});
