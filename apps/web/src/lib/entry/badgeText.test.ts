import { describe, expect, it } from 'vitest';
import { badgeScheme, badgeSchemeParts } from './badgeText';

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
		expect(badgeScheme('My own list')).toBe('My own list');
		expect(badgeScheme('  Jōyō  ')).toBe('Jōyō');
		expect(badgeScheme('HSK mini (sample) list')).toBe('HSK mini (sample) list');
	});
});

describe('badgeSchemeParts', () => {
	it('splits off the approximate qualifier, short to see and full to hear', () => {
		expect(badgeSchemeParts('JLPT kanji (approximate)')).toEqual({
			base: 'JLPT kanji',
			qualifier: { shown: '(approx.)', spoken: '(approximate)' }
		});
	});

	it('has no qualifier for any other scheme name', () => {
		expect(badgeSchemeParts('JLPT (vocabulary)')).toEqual({ base: 'JLPT vocabulary', qualifier: null });
		expect(badgeSchemeParts('My own list')).toEqual({ base: 'My own list', qualifier: null });
	});
});
