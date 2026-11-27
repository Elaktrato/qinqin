import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/settings/romanisation.json';
import {
	ROMANISATION_DEFAULTS,
	ROMANISATION_KEY,
	ROMANISATION_MODES,
	ROMANISATION_TYPES,
	hiddenReadings,
	isReadingShown,
	isReadingTextShown,
	readRomanisation,
	readingTypeOfText,
	romanisationPatch,
	romanisationsOf,
	shownReadings,
	type RomanisationMode,
	type RomanisationType
} from './romanisation';

type Settings = Record<string, unknown> | null;

// docs/contracts/settings/romanisation.json (#284): one rule decides on every screen.
describe('docs/contracts/settings/romanisation.json', () => {
	it('names the key, the types, the modes and the defaults', () => {
		expect(ROMANISATION_KEY).toBe(fixture.key);
		expect([...ROMANISATION_TYPES]).toEqual(fixture.types);
		expect([...ROMANISATION_MODES]).toEqual(fixture.modes);
		expect(ROMANISATION_DEFAULTS).toEqual(fixture.defaults);
	});

	it.each(fixture.parse)('parse: $name', ({ settings, expect: want }) => {
		expect(readRomanisation(settings as Settings)).toEqual(want);
	});

	it.each(fixture.shown)('shown: $name', ({ type, settings, expect: want }) => {
		expect(isReadingShown(type, readRomanisation(settings as Settings))).toBe(want);
	});

	it.each(fixture.textType)('textType: $name', ({ text, language, expect: want }) => {
		expect(readingTypeOfText(text, language)).toBe(want);
	});

	it.each(fixture.languages)('languages: $language', ({ language, types }) => {
		expect(romanisationsOf(language)).toEqual(types);
	});

	it.each(fixture.patch)('patch: $type $mode', ({ type, mode, expect: want }) => {
		expect(romanisationPatch(type as RomanisationType, mode as RomanisationMode)).toEqual(want);
	});
});

describe('romanisation helpers', () => {
	const hidePinyin = readRomanisation({ romanisation: { pinyin: 'never' } });
	const readings = [
		{ type: 'pinyin', value: 'xuéxí' },
		{ type: 'bopomofo', value: 'ㄒㄩㄝˊ ㄒㄧˊ' },
		{ type: 'kana', value: 'がく' }
	];

	it('shownReadings and hiddenReadings split a list in its order', () => {
		expect(shownReadings(readings, hidePinyin).map((r) => r.type)).toEqual(['bopomofo', 'kana']);
		expect(hiddenReadings(readings, hidePinyin).map((r) => r.type)).toEqual(['pinyin']);
		expect(shownReadings(readings, ROMANISATION_DEFAULTS)).toEqual(readings);
		expect(hiddenReadings(readings, ROMANISATION_DEFAULTS)).toEqual([]);
	});

	it('isReadingTextShown types a plain reading string by its script', () => {
		expect(isReadingTextShown('xuéxí', 'zh', hidePinyin)).toBe(false);
		expect(isReadingTextShown('ㄒㄩㄝˊ', 'zh', hidePinyin)).toBe(true);
		expect(isReadingTextShown('学习', 'zh', hidePinyin)).toBe(true);
		const hideRomaji = readRomanisation({ romanisation: { romaji: 'never' } });
		expect(isReadingTextShown('taberu', 'ja', hideRomaji)).toBe(false);
		expect(isReadingTextShown('たべる', 'ja', hideRomaji)).toBe(true);
		expect(isReadingTextShown('', 'ja', hideRomaji)).toBe(true);
	});
});
