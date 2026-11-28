import { describe, expect, it } from 'vitest';
import words from '../../../../../../../docs/contracts/counters/words.json';
import { romanisationView } from '$lib/languages/useRomanisation';
import { ROMANISATION_DEFAULTS } from '$lib/languages/romanisation';
import { parseWords } from './words';
import { measureAnswer, nounItems, otherAnswers, phraseOf } from './nounItems';

const answer = parseWords(words);
// The fixture names nouns by key; give them ids in order.
answer.words.forEach((w, i) => (w.id = i + 1));
const all = { ...ROMANISATION_DEFAULTS };
const shown = romanisationView(() => all);
const hidden = romanisationView(() => ({ ...all, pinyin: 'never', bopomofo: 'never', romaji: 'never' }));

describe('noun items', () => {
	it('keeps the asked order and the language, with the pool of the noun language', () => {
		const zh = nounItems([5, 1, 3, 99], answer, (l) => l === 'zh');
		expect(zh.map((i) => i.key)).toEqual(['5', '1', '3']);
		expect(zh[0].data?.noun.written).toBe('人');
		expect(zh[0].data?.pool).toBe(answer.pools.zh);
		expect(nounItems([2, 4, 6], answer, (l) => l === 'ja').map((i) => i.data?.noun.written)).toEqual(['紙', '本', '水']);
	});

	it('words an answer with its reading only where the romanisation shows', () => {
		const book = answer.words[0];
		expect(measureAnswer(book.measures[0], shown)).toBe('本 (běn)');
		expect(measureAnswer(book.measures[0], hidden)).toBe('本');
		const paper = answer.words[1];
		expect(measureAnswer(paper.measures[0], shown)).toBe('枚【まい】');
		expect(measureAnswer(paper.measures[0], hidden)).toBe('枚【まい】');
		expect(phraseOf(book)).toBe('一本书');
		expect(otherAnswers(book)).toEqual(['册', '部']);
	});
});
