// Which words the reader marks (#68): new and learning tokens of a
// paragraph as code-point ranges, from the loaded matches and the shared
// known predicate (study/known.ts). Known words and matches without a word
// character produce nothing. Contract: docs/contracts/reader/coverage.json
// (the token rule) and word-states.json.
import type { SegmentMatch } from '$lib/api/types';
import { familiarity, type KnownIndex } from '$lib/study/known';

export type WordState = 'new' | 'learning';

export interface WordRange {
	start: number;
	end: number;
	state: WordState;
}

const ZH_WORD = /[\p{Script=Han}々〆]/u;
const JA_WORD = /[\p{Script=Han}々〆\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** isWordChar: Han (and 々 〆); for ja also hiragana and katakana (ー is neither). */
export function isWordChar(char: string, lang: string): boolean {
	return (lang === 'ja' ? JA_WORD : ZH_WORD).test(char);
}

/** isWordToken: the surface holds at least one word character. */
export function isWordToken(surface: string, lang: string): boolean {
	return (lang === 'ja' ? JA_WORD : ZH_WORD).test(surface);
}

export function wordRanges(
	matches: readonly SegmentMatch[],
	index: KnownIndex,
	threshold: number,
	lang: string
): WordRange[] {
	const out: WordRange[] = [];
	for (const m of matches) {
		const first = m.entries[0];
		if (first === undefined || !isWordToken(m.surface, lang)) continue;
		const state = familiarity(first.id, index, threshold);
		if (state !== 'known') out.push({ start: m.start, end: m.end, state });
	}
	return out.sort((a, b) => a.start - b.start);
}
