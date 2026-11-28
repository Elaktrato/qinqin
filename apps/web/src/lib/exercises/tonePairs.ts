// The tone-pair drill's rules (#180; docs/contracts/tones/pairs.json): the 20 two-syllable tone patterns as drill
// items (`<t1>-<t2>`, citation tones, 5 the neutral tone), which dictionary word practises which pair, how a typed
// answer reads, and a pair's accuracy. Pure, no UI; the grading itself is the tone card's (`toneVerdict`, the tone
// contract's sandhi rules).

import type { ReviewGrade } from '$lib/studycore/types';
import { cleanReadings, parsePinyin, pinyinReadings, tonePadLabels, type Tone } from './tones';

/** The 20 items in grid order (first tone 1–4, second 1–5), which is also the order new pairs are introduced. */
export const TONE_PAIRS: readonly string[] = Object.freeze(
	[1, 2, 3, 4].flatMap((first) => [1, 2, 3, 4, 5].map((second) => `${first}-${second}`))
);

const PAIR = /^([1-4])-([1-5])$/;

/** pairTones: the two citation tones of a pair key, or null when it is none of the 20. */
export function pairTones(key: string): [Tone, Tone] | null {
	const m = PAIR.exec(key);
	return m === null ? null : [Number(m[1]) as Tone, Number(m[2]) as Tone];
}

/** pairKey: the key of two tones (`3-4`), or null when they are no pair of the 20. */
export function pairKey(tones: readonly Tone[]): string | null {
	if (tones.length !== 2) return null;
	const key = `${tones[0]}-${tones[1]}`;
	return PAIR.test(key) ? key : null;
}

/**
 * pairKeyOf: the pair a word practises: its written form is exactly two Han characters, it has a clean two-syllable
 * pinyin reading, every clean two-syllable reading has the same citation tones, and the first is not neutral.
 * Otherwise null (polyphones whose readings differ, erhua, other lengths, mixed scripts).
 */
export function pairKeyOf(written: string, readings: readonly { type: string; value: string }[]): string | null {
	if (tonePadLabels(written, 2) === null) return null;
	const two = cleanReadings(pinyinReadings(readings)).filter((r) => r.length === 2);
	if (two.length === 0) return null;
	const keys = new Set(two.map((r) => pairKey(r.map((s) => s.tone))));
	if (keys.size !== 1) return null;
	return [...keys][0];
}

const DIGIT_TONE: Readonly<Record<string, Tone>> = { '0': 5, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };

/**
 * parseTypedTones reads a typed answer as two tones: digits (`34`, `3 4`, `3-4`, `ni3 hao3`; 0 and 5 the neutral
 * tone; full-width digits too), or without a digit tone-marked pinyin of two syllables with at least one mark
 * (`nǐ hǎo`, `mā ma`). Null when it is not two tones.
 */
export function parseTypedTones(text: string): [Tone, Tone] | null {
	const value = text.normalize('NFKC').trim();
	if (value === '') return null;
	const digits = value.match(/\d/g);
	if (digits !== null) {
		if (digits.length !== 2) return null;
		const tones = digits.map((d) => DIGIT_TONE[d]);
		return tones.every((t) => t !== undefined) ? [tones[0], tones[1]] : null;
	}
	const syllables = parsePinyin(value);
	if (syllables.length !== 2 || syllables.every((s) => s.tone === 5)) return null;
	return [syllables[0].tone, syllables[1].tone];
}

/** The last answers a pair's accuracy counts, and its bands. */
export const ACCURACY_WINDOW = 10;
export const WEAK_BELOW = 0.6;
export const STRONG_FROM = 0.85;

export type PairBand = 'new' | 'weak' | 'fair' | 'strong';

export interface PairAccuracy {
	/** The answers counted (at most ACCURACY_WINDOW). */
	answers: number;
	/** Of them, the right ones (Hard, Good, Easy). */
	right: number;
	/** right / answers, null without an answer. */
	accuracy: number | null;
	band: PairBand;
}

/** pairAccuracy: a pair's accuracy over its last ACCURACY_WINDOW answers (grades in answer order) and its band. */
export function pairAccuracy(grades: readonly ReviewGrade[]): PairAccuracy {
	const last = grades.slice(-ACCURACY_WINDOW);
	const right = last.filter((g) => g >= 2).length;
	if (last.length === 0) return { answers: 0, right: 0, accuracy: null, band: 'new' };
	const accuracy = right / last.length;
	const band: PairBand = accuracy < WEAK_BELOW ? 'weak' : accuracy < STRONG_FROM ? 'fair' : 'strong';
	return { answers: last.length, right, accuracy, band };
}
