import { describe, expect, it } from 'vitest';
import { entryShareText, sentenceShareText } from './shareText';

const reading = (value: string, ord: number) => ({ type: 'pinyin', value, plain: value, ord });

describe('entryShareText', () => {
	it('is the headword and the first reading, never a gloss', () => {
		expect(entryShareText({ written: '你好', readings: [reading('nǐ hǎo', 0)] })).toBe('你好 (nǐ hǎo)');
		expect(entryShareText({ written: '行', readings: [reading('xíng', 1), reading('háng', 0)] })).toBe('行 (háng)');
		expect(entryShareText({ written: '猫', readings: [] })).toBe('猫');
	});
});

describe('sentenceShareText', () => {
	it('lists the lines that exist and the origin', () => {
		expect(sentenceShareText({ hanzi: '你好。', pinyin: 'Nǐ hǎo.', translation: 'Hello.' }, 'tatoeba')).toBe('你好。\nNǐ hǎo.\nHello.\n(tatoeba)');
		expect(sentenceShareText({ hanzi: '你好。', pinyin: '', translation: '' }, '')).toBe('你好。');
	});
});
