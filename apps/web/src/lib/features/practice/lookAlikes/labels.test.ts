// What the look-alike drill shows of a member (#228): its readings through the romanisation settings (#284), its
// meaning and its example word; kana answer with the same kana in the other script, romaji only where shown.
import { describe, expect, it } from 'vitest';
import setsFixture from '../../../../../../../docs/contracts/lookalikes/sets.json';
import { romanisationView } from '$lib/languages/useRomanisation';
import { ROMANISATION_DEFAULTS, type Romanisation } from '$lib/languages/romanisation';
import { exampleOf, meaningOf, soundsOf } from './labels';
import { parseSetsFile } from './sets';

const zh = parseSetsFile(setsFixture.fileOf.zh)!;
const ja = parseSetsFile(setsFixture.fileOf.ja)!;
const view = (prefs: Partial<Romanisation> = {}) => romanisationView(() => ({ ...ROMANISATION_DEFAULTS, ...prefs }));
const hidden = view({ pinyin: 'never', bopomofo: 'never', romaji: 'never' });

describe('soundsOf', () => {
	it('shows pinyin and bopomofo where the settings show them', () => {
		expect(soundsOf(zh.characters['未'], view())).toEqual([
			{ text: 'wèi', lang: 'zh-Latn-pinyin' },
			{ text: 'ㄨㄟˋ', lang: 'zh-Bopo' }
		]);
		expect(soundsOf(zh.characters['未'], view({ bopomofo: 'never' }))).toEqual([{ text: 'wèi', lang: 'zh-Latn-pinyin' }]);
		expect(soundsOf(zh.characters['未'], hidden)).toEqual([]);
	});
	it('always shows a kanji its kana readings', () => {
		expect(soundsOf(ja.characters['未'], hidden)).toEqual([{ text: 'ミ、いま(だ)', lang: 'ja' }]);
	});
	it('gives a kana its pair, and its romaji only where shown', () => {
		expect(soundsOf(ja.characters['ソ'], view())).toEqual([
			{ text: 'そ', lang: 'ja' },
			{ text: 'so', lang: 'ja-Latn' }
		]);
		expect(soundsOf(ja.characters['ソ'], hidden)).toEqual([{ text: 'そ', lang: 'ja' }]);
	});
});

describe('meaningOf', () => {
	it('is the meaning of a hanzi or kanji, nothing for a kana', () => {
		expect(meaningOf(zh.characters['末'])).toBe('end; tip');
		expect(meaningOf(ja.characters['力'])).toBe('power');
		expect(meaningOf(ja.characters['ソ'])).toBe('');
	});
});

describe('exampleOf', () => {
	it('gives the example in the workspace script with its readings through the settings', () => {
		expect(exampleOf(zh.characters['末'], 'zh-Hant', view({ bopomofo: 'never' }))).toEqual({
			word: '週末',
			lang: 'zh-Hant',
			sounds: [{ text: 'zhōu mò', lang: 'zh-Latn-pinyin' }],
			meaning: 'weekend'
		});
		expect(exampleOf(zh.characters['末'], 'zh', hidden)).toEqual({ word: '周末', lang: 'zh-Hans', sounds: [], meaning: 'weekend' });
	});
	it('gives a kanji example its kana, a kana example its romaji only where shown', () => {
		expect(exampleOf(ja.characters['力'], 'ja', hidden)).toEqual({ word: '協力', lang: 'ja', sounds: [{ text: 'きょうりょく', lang: 'ja' }], meaning: 'cooperation' });
		expect(exampleOf(ja.characters['ン'], 'ja', view())).toEqual({ word: 'パン', lang: 'ja', sounds: [{ text: 'pan', lang: 'ja-Latn' }], meaning: 'bread' });
		expect(exampleOf(ja.characters['ン'], 'ja', hidden).sounds).toEqual([]);
	});
});
