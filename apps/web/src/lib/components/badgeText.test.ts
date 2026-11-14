import { describe, expect, it } from 'vitest';
import { badgeScheme } from './badgeText';

describe('badgeScheme', () => {
	it('turns a parenthesised qualifier into a plain one', () => {
		expect(badgeScheme('HSK 3.0 (words)')).toBe('HSK 3.0 words');
		expect(badgeScheme('HSK 3.0 (characters)')).toBe('HSK 3.0 characters');
		expect(badgeScheme('JLPT (vocabulary)')).toBe('JLPT vocabulary');
		expect(badgeScheme('JLPT (kanji)')).toBe('JLPT kanji');
	});

	it('keeps an approximate scheme visibly approximate, shortened', () => {
		expect(badgeScheme('JLPT kanji (approximate)')).toBe('JLPT kanji (approx.)');
		expect(badgeScheme('JLPT kanji (Approximate) ')).toBe('JLPT kanji (approx.)');
	});

	it('keeps any other scheme name as it is', () => {
		expect(badgeScheme('My curriculum')).toBe('My curriculum');
		expect(badgeScheme('  Jōyō  ')).toBe('Jōyō');
		expect(badgeScheme('HSK mini (sample) list')).toBe('HSK mini (sample) list');
	});
});
