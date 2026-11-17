import { describe, expect, it } from 'vitest';
import type { LookupResult } from '$lib/api/types';
import {
	dictionaryNames,
	frequencyLabel,
	hasCjk,
	joinForms,
	moreLabel,
	otherForms,
	parseXref,
	readingLine,
	rubyReading,
	senseChips,
	shownSenses
} from './entryDisplay';

function result(patch: Partial<LookupResult>): LookupResult {
	return {
		entryId: 1,
		kind: 'word',
		term: '為る',
		reading: 'する',
		forms: [],
		readings: [],
		matched: 'した',
		start: 0,
		end: 2,
		reasons: [],
		tags: [],
		frequencies: [],
		senses: [],
		pri: 0,
		...patch
	};
}

const sense = (patch: Partial<LookupResult['senses'][number]>) => ({
	dictionaryId: 1,
	dictionaryName: 'JMdict',
	pos: [],
	tags: [],
	glosses: ['to do'],
	xrefs: [],
	...patch
});

describe('rubyReading', () => {
	it('is the reading of a Japanese word written differently', () => {
		expect(rubyReading(result({}), 'ja')).toBe('する');
	});

	it('is empty when the reading equals the term, for characters, and for Chinese', () => {
		expect(rubyReading(result({ term: 'する' }), 'ja')).toBe('');
		expect(rubyReading(result({ kind: 'character', term: '学', reading: 'ガク' }), 'ja')).toBe('');
		expect(rubyReading(result({ term: '行', reading: 'xíng' }), 'zh')).toBe('');
	});
});

describe('readingLine', () => {
	it('joins the pinyin readings of a Chinese entry with a middle dot', () => {
		const r = result({
			term: '行',
			reading: 'xíng',
			readings: [
				{ type: 'pinyin', value: 'xíng', plain: 'xing2' },
				{ type: 'bopomofo', value: 'ㄒㄧㄥˊ', plain: '' },
				{ type: 'pinyin', value: 'háng', plain: 'hang2' },
				{ type: 'pinyin', value: 'xíng', plain: 'xing2' }
			]
		});
		expect(readingLine(r, 'zh')).toBe('xíng · háng');
	});

	it('falls back to the single reading of a Chinese entry without typed readings', () => {
		expect(readingLine(result({ term: '学', reading: 'xué' }), 'zh')).toBe('xué');
	});

	it('groups the readings of a Japanese character by type', () => {
		const r = result({
			kind: 'character',
			term: '下',
			reading: 'カ',
			readings: [
				{ type: 'on', value: 'カ', plain: 'か' },
				{ type: 'on', value: 'ゲ', plain: 'げ' },
				{ type: 'kun', value: 'した', plain: 'した' }
			]
		});
		expect(readingLine(r, 'ja')).toBe('On: カ, ゲ · Kun: した');
	});

	it('is empty for a Japanese word (its reading is ruby)', () => {
		expect(readingLine(result({}), 'ja')).toBe('');
	});
});

describe('otherForms', () => {
	it('lists the written forms other than the term, at most four', () => {
		const forms = ['學習', '学习', 'a', 'b', 'c', 'd'].map((text) => ({ text }));
		expect(otherForms(result({ term: '学习', forms }))).toEqual(['學習', 'a', 'b', 'c']);
	});

	it('hides search-only (sK) forms and keeps irregular or rare ones', () => {
		const forms = [
			{ text: '此れ', flags: ['rK'] },
			{ text: '此', flags: ['sK'] },
			{ text: '是れ', flags: ['sK'] },
			{ text: '之', flags: ['iK'] },
			{ text: '維' }
		];
		expect(otherForms(result({ term: 'これ', forms }))).toEqual(['此れ', '之', '維']);
	});
});

describe('joinForms', () => {
	it('uses the Japanese list comma for Japanese and a middle dot for Chinese', () => {
		expect(joinForms(['為る', '爲る'], 'ja')).toBe('為る、爲る');
		expect(joinForms(['學習', '学習'], 'zh')).toBe('學習 · 学習');
	});
});

describe('frequencyLabel', () => {
	it('prefers the display value, else the rank with thousands separators', () => {
		expect(frequencyLabel({ packId: 1, packName: 'Jiten', rank: 12345 })).toBe('12,345');
		expect(frequencyLabel({ packId: 1, packName: 'Jiten', rank: 12345, display: '12k' })).toBe('12k');
	});
});

describe('dictionaryNames', () => {
	it('lists each source dictionary once, in order', () => {
		const r = result({ senses: [sense({}), sense({ dictionaryId: 2, dictionaryName: 'Other' }), sense({})] });
		expect(dictionaryNames(r)).toEqual(['JMdict', 'Other']);
	});
});

describe('shownSenses', () => {
	it('keeps only senses with glosses', () => {
		const r = result({ senses: [sense({ glosses: [] }), sense({ glosses: ['to do'] })] });
		expect(shownSenses(r)).toHaveLength(1);
	});
});

describe('senseChips', () => {
	it('is the part of speech plus the tags except uk', () => {
		expect(senseChips(sense({ pos: ['vs-i', 'vt'], tags: ['uk', 'col'] }))).toEqual(['vs-i', 'vt', 'col']);
	});
});

describe('hasCjk', () => {
	it('finds Han or kana in a gloss', () => {
		expect(hasCjk('variant of 馬|马[ma3]')).toBe(true);
		expect(hasCjk('see する')).toBe(true);
		expect(hasCjk('ヘルプ')).toBe(true);
		expect(hasCjk('𠮷')).toBe(true);
		expect(hasCjk('to do; to perform')).toBe(false);
	});
});

describe('parseXref', () => {
	it('splits a JMdict xref into headword, reading and sense number', () => {
		expect(parseXref('歯・は・1')).toEqual({ headword: '歯', reading: 'は', senseNo: 1 });
		expect(parseXref('選ばれし者・えらばれしもの')).toEqual({ headword: '選ばれし者', reading: 'えらばれしもの' });
		expect(parseXref('五刑・2')).toEqual({ headword: '五刑', senseNo: 2 });
		expect(parseXref('た・1')).toEqual({ headword: 'た', senseNo: 1 });
	});

	it('keeps a plain headword as it is', () => {
		expect(parseXref('漢詩')).toEqual({ headword: '漢詩' });
		expect(parseXref('お願いします')).toEqual({ headword: 'お願いします' });
	});
});

describe('moreLabel', () => {
	it('counts what is hidden, singular and plural', () => {
		expect(moreLabel(1, 'sense')).toBe('Show 1 more sense');
		expect(moreLabel(4, 'entry')).toBe('Show 4 more entries');
	});
});
