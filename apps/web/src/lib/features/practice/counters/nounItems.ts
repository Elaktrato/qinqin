// The noun items of the measure-word and counter drills (#179): the learner's studied nouns that have data, in the
// order of their first review (item: the entry id), each with the pool of wrong choices of its language; and the
// words of an answer (the measure word with its reading where the romanisation setting shows it).

import type { RomanisationView } from '$lib/languages/useRomanisation';
import type { DrillItem } from '../types';
import type { CounterMeasure, CounterNoun, WordsAnswer } from './words';

export interface NounItemData {
	noun: CounterNoun;
	pool: CounterMeasure[];
}

/** nounItems: the nouns of `ids` (in that order) the answer has, of the languages the drill takes. */
export function nounItems(ids: readonly number[], answer: WordsAnswer, language: (code: string) => boolean): DrillItem<NounItemData>[] {
	const byId = new Map(answer.words.filter((w) => language(w.language)).map((w) => [w.id, w]));
	const out: DrillItem<NounItemData>[] = [];
	for (const id of ids) {
		const noun = byId.get(id);
		if (noun !== undefined) out.push({ key: String(id), data: { noun, pool: answer.pools[noun.language] ?? [] } });
	}
	return out;
}

/** measureAnswer: 本 (běn) — pinyin or bopomofo only where shown; a counter with its kana, 枚【まい】. */
export function measureAnswer(m: CounterMeasure, roman: RomanisationView): string {
	const kana = m.readings.find((r) => r.type === 'kana');
	if (kana !== undefined) return kana.value === m.written ? m.written : `${m.written}【${kana.value}】`;
	const reading = roman.shown(m.readings.filter((r) => r.type === 'pinyin' || r.type === 'bopomofo'))[0];
	return reading === undefined ? m.written : `${m.written} (${reading.value})`;
}

/** phraseOf: the noun counted once with its measure word (一本书). */
export function phraseOf(noun: CounterNoun): string {
	return `一${noun.measures[0].written}${noun.written}`;
}

/** otherAnswers: the noun's other right measure words or counters, after the first. */
export function otherAnswers(noun: CounterNoun): string[] {
	return noun.measures.slice(1).map((m) => m.written);
}
