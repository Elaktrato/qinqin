// One tone-pair question's answer (#180): the field holds the two tones as typed (docs/contracts/tones/pairs.json
// `typed`); the tone buttons write into it, with `?` for a syllable not chosen yet. The verdict is the tone card's
// (`toneVerdict`, the tone contract's sandhi rules and the workspace's "Grade spoken tones"); both tones right is
// Good, anything wrong Again.

import { parseTypedTones } from '$lib/exercises/tonePairs';
import { cleanReadings, pinyinReadings, tonePadLabels, toneVerdict, type Tone, type ToneVerdict } from '$lib/exercises/tones';
import type { ReviewGrade } from '$lib/studycore/types';
import type { PairWord } from './words';

/** The drill's one mode: see (or hear) the word, mark both tones. */
export const PAIR_MODE = 'mark';

const DIGIT: Readonly<Record<string, Tone>> = { '0': 5, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };

/** slotsOf: the two tones the field shows so far (a typed answer, or digits and `?` placeholders in order). */
export function slotsOf(text: string): [Tone | null, Tone | null] {
	const full = parseTypedTones(text);
	if (full !== null) return full;
	const slots: (Tone | null)[] = [];
	for (const ch of text.normalize('NFKC')) {
		if (slots.length === 2) break;
		if (ch === '?') slots.push(null);
		else if (/\d/.test(ch)) slots.push(DIGIT[ch] ?? null);
	}
	return [slots[0] ?? null, slots[1] ?? null];
}

/** textOf: the field's text for two slots (`3 4`, `? 4`). */
export function textOf(slots: readonly (Tone | null)[]): string {
	return [0, 1].map((i) => slots[i] ?? '?').join(' ');
}

export interface PairCheck {
	tones: [Tone, Tone];
	verdict: ToneVerdict;
	grade: ReviewGrade;
}

/** checkPair: the verdict of a typed answer for a word, or null when the text is not two tones. */
export function checkPair(text: string, word: PairWord, gradeSpoken: boolean): PairCheck | null {
	const tones = parseTypedTones(text);
	if (tones === null) return null;
	const candidates = cleanReadings(pinyinReadings(word.readings));
	const verdict = toneVerdict(tones, candidates, { chars: tonePadLabels(word.written, 2), gradeSpoken });
	return { tones, verdict, grade: verdict.correct ? 3 : 1 };
}
