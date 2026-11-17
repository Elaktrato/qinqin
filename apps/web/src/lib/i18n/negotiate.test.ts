import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES, formatLocale, isLanguageSetting, negotiate } from './negotiate';

// Unit cases beside negotiate.json and language-tags.json (contract.test.ts).

describe('negotiate', () => {
	it('walks candidates in order and returns the supported spelling', () => {
		expect(negotiate(['xx', 'DE-at', 'fr'], ['en', 'fr', 'de'])).toBe('de');
	});
	it('inserts the zh script before truncating', () => {
		expect(negotiate(['zh-HK'], ['zh-Hant', 'zh-Hans'])).toBe('zh-Hant');
		expect(negotiate(['zh-Hans-HK'], ['zh-Hant', 'zh-Hans'])).toBe('zh-Hans');
	});
	it('falls back to en, also for junk input', () => {
		expect(negotiate([], ['en'])).toBe('en');
		expect(negotiate(['', '*', '---'], ['en', 'de'])).toBe('en');
	});
	it('today only en is supported, so everything resolves to en', () => {
		expect(SUPPORTED_LANGUAGES).toEqual(['en']);
		expect(negotiate(['zh-TW', 'ja'], SUPPORTED_LANGUAGES)).toBe('en');
	});
});

describe('formatLocale', () => {
	it('adds the device region to the interface language', () => {
		expect(formatLocale('en', ['en-GB'])).toBe('en-GB');
		expect(formatLocale('en', ['fr-FR'])).toBe('en');
	});
	it('falls back to en when Intl cannot resolve the result', () => {
		expect(formatLocale('not a tag', [])).toBe('en');
		expect(formatLocale('en', ['en-!!'])).toBe('en');
	});
	it('ignores device entries that are not strings', () => {
		expect(formatLocale('en', [undefined as unknown as string, 'en-NZ'])).toBe('en-NZ');
	});
});

describe('isLanguageSetting', () => {
	it('accepts the empty string and canonical tags only', () => {
		expect(isLanguageSetting('')).toBe(true);
		expect(isLanguageSetting('zh-Hant-TW')).toBe(true);
		expect(isLanguageSetting('zh-hant')).toBe(false);
	});
});
