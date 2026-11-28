import { describe, expect, it } from 'vitest';

import type { Entry, Reading, SenseGroup, SenseView, Sentence } from '$lib/api/types';
import { buildVocabFaces, withShownWritten } from './cardView';

function reading(type: string, value: string, ord = 0): Reading {
	return { type, value, plain: value, ord };
}

function sense(dictionaryName: string, gloss: string, dictionaryId = 1): SenseView {
	return {
		dictionaryId,
		dictionaryName,
		packId: 'test-pack',
		license: 'CC BY-SA',
		attribution: 'Test dictionary',
		gloss
	};
}

function plain(text: string): { text: string; mark: null } {
	return { text, mark: null };
}

function group(dictionaryName: string, glosses: string[], dictionaryId = 1): SenseGroup {
	return {
		dictionaryId,
		dictionaryName,
		packId: 'test-pack',
		license: 'CC BY-SA',
		attribution: 'Test dictionary',
		pos: [],
		tags: [],
		glosses,
		xrefs: []
	};
}

function sentence(hanzi: string, id = 1): Sentence {
	return {
		id,
		entryId: 1,
		sourcePack: 'test-pack',
		userId: null,
		hanzi,
		pinyin: '',
		translation: ''
	};
}

function entry(overrides: Partial<Entry> = {}): Entry {
	return {
		id: 1,
		language: 'zh',
		kind: 'word',
		written: '你好',
		readings: [reading('pinyin', 'nǐ hǎo')],
		attrs: {},
		radicalId: null,
		badges: [],
		variants: [],
		sentences: [],
		senses: [],
		...overrides
	};
}

describe('buildVocabFaces', () => {
	it('blanks the written form in the sentence on both faces', () => {
		const faces = buildVocabFaces(entry(), sentence('你好世界'), 'zh');

		expect(faces.front.sentenceLines).toEqual(['____世界']);
		expect(faces.back.sentenceLines).toEqual(['____世界']);
		expect(faces.front.written).toBe('你好');
		expect(faces.back.written).toBe('你好');
	});

	it('keeps the sentence unchanged when it does not contain the word', () => {
		const faces = buildVocabFaces(entry(), sentence('再见世界'), 'zh');

		expect(faces.front.sentenceLines).toEqual(['再见世界']);
		expect(faces.back.sentenceLines).toEqual(['再见世界']);
	});

	it('has no sentence lines when there is no sentence', () => {
		const faces = buildVocabFaces(entry(), null, 'zh');

		expect(faces.front.sentenceLines).toEqual([]);
		expect(faces.back.sentenceLines).toEqual([]);
	});

	it('preserves every reading in its existing order and type', () => {
		const faces = buildVocabFaces(
			entry({
				readings: [
					reading('pinyin', 'nǐ hǎo', 0),
					reading('bopomofo', 'ㄋㄧˇ ㄏㄠˇ', 1),
					reading('pack-extended', 'ni hao', 2)
				]
			}),
			null,
			'zh'
		);

		const expected = [
			{ type: 'pinyin', value: 'nǐ hǎo' },
			{ type: 'bopomofo', value: 'ㄋㄧˇ ㄏㄠˇ' },
			{ type: 'pack-extended', value: 'ni hao' }
		];
		expect(faces.front.readings).toEqual(expected);
		expect(faces.back.readings).toEqual(expected);
	});

	it('groups glosses by dictionary in first-seen order and dedupes names', () => {
		const faces = buildVocabFaces(
			entry({
				senses: [
					sense('Alpha', 'hello', 1),
					sense('Beta', 'hi', 2),
					sense('Alpha', 'how do you do', 1),
					sense('Gamma', 'greetings', 3),
					sense('Beta', 'hey', 2)
				]
			}),
			null,
			'zh'
		);

		expect(faces.back.glosses).toEqual([
			{ dictionaryName: 'Alpha', glosses: [plain('hello'), plain('how do you do')] },
			{ dictionaryName: 'Beta', glosses: [plain('hi'), plain('hey')] },
			{ dictionaryName: 'Gamma', glosses: [plain('greetings')] }
		]);
		expect(faces.back.folded).toEqual([]);
	});

	it('folds slang and vulgar glosses behind the others (#345, senses/display.json)', () => {
		const groups: SenseGroup[] = [
			group('CC-CEDICT', ['fowl', 'chicken', 'CL:隻|只[zhi1]', '(slang) prostitute']),
			group('CC-CEDICT', ['variant of 雞|鸡[ji1]'])
		];
		const faces = buildVocabFaces(entry({ written: '鸡', senseGroups: groups }), null, 'zh');
		expect(faces.back.glosses).toEqual([
			{
				dictionaryName: 'CC-CEDICT',
				glosses: [plain('fowl'), plain('chicken'), plain('CL:隻|只[zhi1]'), plain('variant of 雞|鸡[ji1]')]
			}
		]);
		expect(faces.back.folded).toEqual([
			{ dictionaryName: 'CC-CEDICT', glosses: [{ text: '(slang) prostitute', mark: 'vulg' }] }
		]);
	});

	it("shows only the pinned reading's meanings, minor lines last (#346)", () => {
		const groups: SenseGroup[] = [
			{ ...group('CC-CEDICT', ['surname Mao']), tags: ['reading:Máo'] },
			{ ...group('CC-CEDICT', ['cat (CL:隻|只[zhi1])', '(dialect) to hide oneself']), tags: ['reading:māo'] },
			{ ...group('CC-CEDICT', ['used in 貓腰|猫腰[mao2 yao1]']), tags: ['reading:máo'] }
		];
		const cat = entry({ written: '猫', senseGroups: groups });
		expect(buildVocabFaces(cat, null, 'zh', 'māo').back.glosses).toEqual([
			{ dictionaryName: 'CC-CEDICT', glosses: [plain('cat (CL:隻|只[zhi1])'), plain('(dialect) to hide oneself')] }
		]);
		expect(buildVocabFaces(cat, null, 'zh').back.glosses[0].glosses.map((g) => g.text)).toEqual([
			'cat (CL:隻|只[zhi1])',
			'(dialect) to hide oneself',
			'surname Mao',
			'used in 貓腰|猫腰[mao2 yao1]'
		]);
	});

	it('shows a vulgar-only word unfolded, marked', () => {
		const faces = buildVocabFaces(entry({ written: '鸡巴', senseGroups: [group('CC-CEDICT', ['dick', 'penis (vulgar)'])] }), null, 'zh');
		expect(faces.back.glosses).toEqual([
			{ dictionaryName: 'CC-CEDICT', glosses: [{ text: 'dick', mark: 'vulg' }, { text: 'penis (vulgar)', mark: 'vulg' }] }
		]);
		expect(faces.back.folded).toEqual([]);
	});

	it('produces the same card for different languages', () => {
		const japanese = entry({
			language: 'ja',
			written: '食べる',
			readings: [reading('kana', 'たべる'), reading('romaji', 'taberu', 1)],
			senses: [sense('JMdict', 'to eat', 4)]
		});
		const example = sentence('ご飯を食べる');

		expect(buildVocabFaces(japanese, example, 'ja')).toEqual(
			buildVocabFaces(japanese, example, 'zh')
		);
	});

	it('blanks every occurrence of a multi-character word', () => {
		const faces = buildVocabFaces(entry({ written: '好' }), sentence('你好，好久不见'), 'zh');

		expect(faces.front.sentenceLines).toEqual(['你____，____久不见']);
	});

	it('does not blank a one-kana headword inside other words (の in この)', () => {
		const faces = buildVocabFaces(entry({ written: 'の' }), sentence('この本は私の本です'), 'ja');

		expect(faces.front.sentenceLines).toEqual(['この本は私の本です']);
	});

	it('still blanks a longer kana headword (こと)', () => {
		const faces = buildVocabFaces(entry({ written: 'こと' }), sentence('見たことがある'), 'ja');

		expect(faces.front.sentenceLines).toEqual(['見た____がある']);
	});

	it('does not inject blanks when the written form is empty', () => {
		const faces = buildVocabFaces(entry({ written: '' }), sentence('你好世界'), 'zh');

		expect(faces.front.sentenceLines).toEqual(['你好世界']);
	});
});

describe('buildVocabFaces for a character', () => {
	const kanji = entry({
		kind: 'character',
		language: 'ja',
		written: '学',
		readings: [reading('on', 'ガク'), reading('kun', 'まな.ぶ', 1), reading('on', 'ガッ', 2)],
		senses: [sense('KANJIDIC', 'study')]
	});

	it('shows the glyph alone on the front', () => {
		const { front } = buildVocabFaces(kanji, sentence('学校'), 'ja');
		expect(front).toEqual({ written: '学', readings: [], sentenceLines: [] });
	});

	it('puts every reading on the back, grouped by type, with the glosses', () => {
		const { back } = buildVocabFaces(kanji, null, 'ja');
		expect(back.readings.map((r) => r.value)).toEqual(['ガク', 'ガッ', 'まな.ぶ']);
		expect(back.glosses).toEqual([{ dictionaryName: 'KANJIDIC', glosses: [plain('study')] }]);
	});

	it('keeps a word back equal to its front readings', () => {
		const faces = buildVocabFaces(entry(), null, 'zh');
		expect(faces.back.readings).toEqual(faces.front.readings);
	});
});

describe('withShownWritten', () => {
	const inu: Entry = {
		id: 1,
		language: 'ja',
		kind: 'word',
		written: '犬',
		readings: [{ type: 'kana', value: 'いぬ', plain: 'いぬ', ord: 0 }],
		senses: [],
		sentences: [],
		variants: [],
		badges: [],
		attrs: {},
		radicalId: null
	};

	it('a starter-copied いぬ card shows いぬ on its front', () => {
		const shown = withShownWritten(inu, 'いぬ');
		expect(shown.written).toBe('いぬ');
		expect(buildVocabFaces(shown, null, 'ja').front.written).toBe('いぬ');
	});

	it('keeps the entry when there is no snapshot, a kanji snapshot or a kana that is no reading', () => {
		expect(withShownWritten(inu, undefined)).toBe(inu);
		expect(withShownWritten(inu, '狗').written).toBe('犬');
		expect(withShownWritten(inu, 'ねこ').written).toBe('犬');
	});
});
