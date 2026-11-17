import { describe, expect, it } from 'vitest';
import { glossLang, readingLang, studyLang, wordReadingLang } from './lang';

// The one source of a `lang` attribute on study text (spec "lang and dir attributes"): the workspace (or book or
// pack) language, with the script the text is shown in; interface text never carries its own `lang`.

describe('studyLang', () => {
	it('names the script of Chinese (zh reads as simplified) and keeps other languages', () => {
		expect(studyLang('zh')).toBe('zh-Hans');
		expect(studyLang('zh-Hant')).toBe('zh-Hant');
		expect(studyLang('zh-TW')).toBe('zh-TW');
		expect(studyLang('ja')).toBe('ja');
		expect(studyLang('ko')).toBe('ko');
	});
	it('follows a script variant: converted text names its script, the original keeps the stored language', () => {
		expect(studyLang('zh', { variant: 'simplified' })).toBe('zh-Hans');
		expect(studyLang('zh', { variant: 'traditional' })).toBe('zh-Hant');
		expect(studyLang('zh', { variant: 'original' })).toBe('zh');
		expect(studyLang('ja', { variant: 'traditional' })).toBe('ja');
	});
	it('an unknown or empty language gives no attribute value (undefined): nothing is guessed', () => {
		expect(studyLang('')).toBeUndefined();
		expect(studyLang(undefined)).toBeUndefined();
	});
});

describe('readingLang', () => {
	it.each([
		['pinyin', 'zh', 'zh-Latn-pinyin'],
		['bopomofo', 'zh', 'zh-Bopo'],
		['kana', 'ja', 'ja'],
		['on', 'ja', 'ja'],
		['kun', 'ja', 'ja'],
		['romaji', 'ja', 'ja-Latn'],
		['Pinyin', 'zh-Hant', 'zh-Latn-pinyin'],
		['other', 'ko', 'ko']
	])('%s of %s → %s', (type, language, want) => expect(readingLang(type, language)).toBe(want));
});

describe('wordReadingLang', () => {
	it('is the main reading of a word in the language: pinyin for Chinese, kana for Japanese', () => {
		expect(wordReadingLang('zh')).toBe('zh-Latn-pinyin');
		expect(wordReadingLang('zh-Hant')).toBe('zh-Latn-pinyin');
		expect(wordReadingLang('ja')).toBe('ja');
		expect(wordReadingLang('ko')).toBe('ko');
		expect(wordReadingLang('')).toBeUndefined();
	});
});

describe('glossLang', () => {
	it('is the gloss language of the dictionary pack, English by default', () => {
		expect(glossLang(undefined)).toBe('en');
		expect(glossLang('')).toBe('en');
		expect(glossLang('de')).toBe('de');
	});
});
