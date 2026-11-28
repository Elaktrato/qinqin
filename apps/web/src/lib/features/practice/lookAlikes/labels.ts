// What the look-alike drill shows of a member (#228; docs/contracts/lookalikes/README.md, "Questions and answers"):
// its readings, only those the romanisation settings show (#284; kana readings of a kanji always), its meaning and its
// example word. A kana's reading is the same kana in the other script, with its romaji where shown.

import { readingLang, studyLang } from '$lib/i18n/lang';
import type { RomanisationView } from '$lib/languages/useRomanisation';
import { exampleWord, type LookAlikeCharacter } from './sets';

/** A piece of text with the `lang` it is read in. */
export interface Piece {
	text: string;
	lang: string;
}

function chinese(pinyin: string, bopomofo: string, roman: RomanisationView): Piece[] {
	return roman
		.shown([
			{ type: 'pinyin', value: pinyin },
			{ type: 'bopomofo', value: bopomofo }
		])
		.map((r) => ({ text: r.value, lang: readingLang(r.type, 'zh') ?? 'zh' }));
}

function romaji(text: string, roman: RomanisationView): Piece[] {
	return roman.shows('romaji') ? [{ text, lang: readingLang('romaji', 'ja') ?? 'ja-Latn' }] : [];
}

/** soundsOf: a member's readings as shown. */
export function soundsOf(c: LookAlikeCharacter, roman: RomanisationView): Piece[] {
	switch (c.kind) {
		case 'hanzi':
			return chinese(c.pinyin.join(', '), c.bopomofo.join(', '), roman);
		case 'kanji':
			return [{ text: c.readings.join('、'), lang: 'ja' }];
		case 'kana':
			return [{ text: c.pair, lang: 'ja' }, ...romaji(c.romaji, roman)];
	}
}

/** meaningOf: a hanzi's or kanji's meaning; a kana has none (its sound is its answer). */
export function meaningOf(c: LookAlikeCharacter): string {
	return c.kind === 'kana' ? '' : c.meaning;
}

/** exampleOf: the member's example word in the workspace's script, its readings as shown, its meaning. */
export function exampleOf(c: LookAlikeCharacter, language: string, roman: RomanisationView): { word: string; lang: string; sounds: Piece[]; meaning: string } {
	const lang = studyLang(language) ?? language;
	const word = exampleWord(c, language);
	switch (c.kind) {
		case 'hanzi':
			return { word, lang, sounds: chinese(c.example.pinyin, c.example.bopomofo, roman), meaning: c.example.meaning };
		case 'kanji':
			return { word, lang, sounds: [{ text: c.example.reading, lang: 'ja' }], meaning: c.example.meaning };
		case 'kana':
			return { word, lang, sounds: romaji(c.example.romaji, roman), meaning: c.example.meaning };
	}
}
