// Tone sandhi (#300; docs/contracts/tones/): the spoken tones of a Mandarin reading, worked out from its citation
// tones (the dictionary's), its characters and its word boundaries. Shared by the Tones flashcard and the tone-pair
// drill (#180); pure, no UI.

import type { Tone } from './tones';

/** One syllable as the rules see it. */
export interface SandhiSyllable {
	/** Its Han character, or null when the written form is not one Han character per syllable. */
	char: string | null;
	/** The syllable without its tone mark (`bu`, `yi`). */
	plain: string;
	/** Its citation tone. */
	tone: Tone;
}

/** Characters next to which 一 is a number read out and keeps its 1st tone (十一, 一一). */
export const NUMERALS = ['〇', '零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '两', '兩'] as const;
/** Characters after which 一 is an ordinal and keeps its 1st tone (第一, 初一). */
export const ORDINAL_BEFORE = ['第', '初'] as const;

const isNumeral = (char: string | null | undefined): boolean =>
	char != null && (NUMERALS as readonly string[]).includes(char);

const isBu = (s: SandhiSyllable): boolean => s.char === '不' && s.plain === 'bu' && s.tone === 4;
const isYi = (s: SandhiSyllable): boolean => s.char === '一' && s.plain === 'yi' && s.tone === 1;

/** The word of each syllable (an index), from syllable counts per word; one word when they do not add up. */
function wordOf(count: number, words: readonly number[] | undefined): number[] {
	const valid =
		words !== undefined &&
		words.every((n) => Number.isInteger(n) && n > 0) &&
		words.reduce((sum, n) => sum + n, 0) === count;
	if (!valid) return Array.from({ length: count }, () => 0);
	return words.flatMap((n, w) => Array.from({ length: n }, () => w));
}

/** The spoken tone of 一 at `i`, by the next syllable's citation tone and its neighbours. */
function yiTone(syllables: readonly SandhiSyllable[], i: number): Tone {
	const next = syllables[i + 1];
	const before = syllables[i - 1]?.char;
	if (next === undefined || next.tone === 5) return 1;
	if (before != null && (ORDINAL_BEFORE as readonly string[]).includes(before)) return 1;
	if (isNumeral(before) || isNumeral(next.char)) return 1;
	return next.tone === 4 ? 2 : 4;
}

/**
 * spokenTones: the tone each syllable is spoken with (docs/contracts/tones/README.md): 不 before a 4th tone is 2;
 * 一 is 2 before a 4th tone and 4 before tones 1–3 (it stays 1 alone, at the end, before a neutral tone, as an
 * ordinal and next to a numeral); a 3rd tone before a 3rd tone is 2, right to left — inside a word against the
 * next citation tone, across a word boundary (`words`: syllable counts per word) against the next spoken tone.
 */
export function spokenTones(syllables: readonly SandhiSyllable[], words?: readonly number[]): Tone[] {
	const spoken: Tone[] = syllables.map((s, i) => {
		const next = syllables[i + 1];
		if (isBu(s)) return next !== undefined && next.tone === 4 ? 2 : 4;
		if (isYi(s)) return yiTone(syllables, i);
		return s.tone;
	});
	const word = wordOf(syllables.length, words);
	for (let i = syllables.length - 2; i >= 0; i--) {
		if (syllables[i].tone !== 3) continue;
		const following = word[i] === word[i + 1] ? syllables[i + 1].tone : spoken[i + 1];
		spoken[i] = following === 3 ? 2 : 3;
	}
	return spoken;
}
