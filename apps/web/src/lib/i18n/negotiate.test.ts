import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES, catalogueLanguages, formatLocale, isLanguageSetting, negotiate } from './negotiate';

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

describe('catalogueLanguages: the list is the catalogue files (#297)', () => {
	it('is every messages/<tag>.json, en first, the rest sorted; notes.json and other names are not languages', () => {
		const files = ['./messages/notes.json', './messages/ja.json', './messages/en.json', './messages/de.json', './messages/zh-Hant.json'];
		expect(catalogueLanguages(files)).toEqual(['en', 'de', 'ja', 'zh-Hant']);
		expect(catalogueLanguages(['./messages/README.json', './messages/EN.json', './messages/de_DE.json', './other/fr.json'])).toEqual(['en']);
	});

	it('always has en (the source catalogue), even when handed no files', () => {
		expect(catalogueLanguages([])).toEqual(['en']);
	});

	it('a second catalogue file makes it negotiable with no other change', () => {
		const supported = catalogueLanguages(['./messages/en.json', './messages/xx.json']);
		expect(negotiate(['xx-YY'], supported)).toBe('xx');
	});
});

describe('formatLocale', () => {
	it('adds the device region to the interface language', () => {
		expect(formatLocale('en', ['en-GB'])).toBe('en-GB');
		expect(formatLocale('en', ['en-US'])).toBe('en-US');
	});
	it('formats English without a device region as en-GB (day before month, as the interface always wrote dates)', () => {
		expect(formatLocale('en', ['fr-FR'])).toBe('en-GB');
		expect(formatLocale('en', [])).toBe('en-GB');
	});
	it('falls back to en-GB when Intl cannot resolve the result', () => {
		expect(formatLocale('not a tag', [])).toBe('en-GB');
		expect(formatLocale('en', ['en-!!'])).toBe('en-GB');
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
