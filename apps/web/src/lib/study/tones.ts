import { profileOf } from '../languageProfiles';
import type { ReviewGrade } from './types';
import { isHan } from './writing';

/** Mandarin tone; 5 is the neutral tone. */
export type Tone = 1 | 2 | 3 | 4 | 5;

export interface Syllable {
	/** The syllable as written (lower case, NFC, ü for v), tone mark kept. */
	text: string;
	/** The syllable without its tone mark; ü is kept (never v). */
	plain: string;
	tone: Tone;
}

export interface GesturePoint {
	x: number;
	y: number;
}

/** Combining tone marks (as found in NFD text) mapped to their tone. */
const TONE_MARKS: Record<string, Tone> = {
	'̄': 1, // macron
	'́': 2, // acute
	'̌': 3, // caron
	'̀': 4 // grave
};

/** Reverse lookup, built once. */
const MARK_FOR_TONE: Record<number, string> = Object.fromEntries(
	Object.entries(TONE_MARKS).map(([mark, tone]) => [tone, mark])
);

/** Apostrophes and whitespace separate syllables. */
const SEPARATORS = /[\s'’ʼ`]+/;

function parseSyllable(token: string): Syllable | null {
	let tone: Tone = 5;
	let plain = '';
	// NFD splits precomposed letters (ǚ, é, ...) into base + combining marks,
	// so the tone mark is found independent of which vowel carries it.
	for (const ch of token.normalize('NFD')) {
		const mark = TONE_MARKS[ch];
		if (mark !== undefined) tone = mark;
		else plain += ch;
	}
	// v is the ASCII stand-in for ü.
	plain = plain.normalize('NFC').replace(/v/g, 'ü');
	if (plain === '') return null;
	const text = tone === 5 ? plain : withMark(plain, tone);
	return { text, plain, tone };
}

/** Index of the vowel that carries the tone mark: a/e, the o of ou, else the last vowel. */
function markIndex(plain: string): number {
	const vowels = 'aeiouü';
	const a = plain.search(/[ae]/);
	if (a >= 0) return a;
	const ou = plain.indexOf('ou');
	if (ou >= 0) return ou;
	for (let i = plain.length - 1; i >= 0; i--) if (vowels.includes(plain[i])) return i;
	return plain.length - 1;
}

function withMark(plain: string, tone: Tone): string {
	const mark = MARK_FOR_TONE[tone] ?? '';
	const at = markIndex(plain);
	return (plain.slice(0, at + 1).normalize('NFD') + mark + plain.slice(at + 1)).normalize('NFC');
}

/**
 * Parses tone-marked pinyin ("xué xí", "nǚ'ér", "lǜ") into syllables.
 *
 * Syllables are separated by whitespace or apostrophes. Input is lower-cased
 * and Unicode-normalised, so precomposed and decomposed marks are equal; `v`
 * is read as ü. A syllable without a mark is neutral (5). A lone `r` (as in
 * "huā r" or "huā'r") is erhua and folds into the previous syllable; "huār"
 * stays one syllable. Run-together syllables without a separator ("xuéxí")
 * are not split.
 */
export function parsePinyin(value: string): Syllable[] {
	const out: Syllable[] = [];
	for (const token of value.toLowerCase().split(SEPARATORS)) {
		if (token === '') continue;
		const syllable = parseSyllable(token);
		if (!syllable) continue;
		const previous = out[out.length - 1];
		if (previous && syllable.plain === 'r' && syllable.tone === 5) {
			previous.text += 'r';
			previous.plain += 'r';
			continue;
		}
		out.push(syllable);
	}
	return out;
}

const DEFAULT_MIN_DISTANCE = 24;
const FLAT_DEGREES = 25;

/**
 * Maps a swipe to the tone whose shape it draws. Coordinates are screen
 * coordinates: x grows to the right and y grows DOWNWARD.
 *
 *  - shorter than `minDistance` (px, default 24): tap, neutral (5)
 *  - a dip (down by at least `minDistance`, then up by at least that, the
 *    lowest point strictly inside the path): 3
 *  - otherwise by the start-to-end vector: within 25 degrees of horizontal,
 *    either direction: flat, 1; rising: 2; falling: 4
 *
 * Overload 1, `(dx, dy, minDistance?)`, takes one vector (no dip possible);
 * overload 2, `(path, minDistance?)`, takes the sampled pointer path.
 */
export function toneFromGesture(dx: number, dy: number, minDistance?: number): Tone;
export function toneFromGesture(path: readonly GesturePoint[], minDistance?: number): Tone;
export function toneFromGesture(
	first: number | readonly GesturePoint[],
	second?: number,
	third?: number
): Tone {
	if (typeof first === 'number') {
		return vectorTone(first, second ?? 0, third ?? DEFAULT_MIN_DISTANCE);
	}
	const min = second ?? DEFAULT_MIN_DISTANCE;
	if (first.length < 2) return 5;
	const start = first[0];
	const end = first[first.length - 1];
	let low = 0;
	for (let i = 1; i < first.length; i++) if (first[i].y > first[low].y) low = i;
	const interior = low > 0 && low < first.length - 1;
	if (interior && first[low].y - start.y >= min && first[low].y - end.y >= min) return 3;
	return vectorTone(end.x - start.x, end.y - start.y, min);
}

function vectorTone(dx: number, dy: number, min: number): Tone {
	if (Math.hypot(dx, dy) < min) return 5;
	const fromHorizontal = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
	if (fromHorizontal <= FLAT_DEGREES) return 1;
	return dy < 0 ? 2 : 4;
}

/**
 * Compares the chosen tones with every candidate reading of the same length
 * (polyphones have several) and reports the best one. No candidate with the
 * same syllable count means everything is wrong.
 */
export function checkTones(
	chosen: readonly Tone[],
	candidates: readonly (readonly Syllable[])[]
): { correct: boolean; wrong: number } {
	let best = chosen.length;
	let found = false;
	for (const candidate of candidates) {
		if (candidate.length !== chosen.length) continue;
		let wrong = 0;
		for (let i = 0; i < chosen.length; i++) if (candidate[i].tone !== chosen[i]) wrong++;
		if (!found || wrong < best) best = wrong;
		found = true;
	}
	if (!found) return { correct: false, wrong: chosen.length };
	return { correct: best === 0, wrong: best };
}

/** 0 wrong tones: Good (3), 1: Hard (2), more: Again (1). */
export function suggestToneGrade(wrong: number): ReviewGrade {
	if (wrong <= 0) return 3;
	return wrong === 1 ? 2 : 1;
}

/** A syllable is clean when it is made of letters only (ü included): no digits or punctuation. */
function isClean(syllable: Syllable): boolean {
	return /^\p{L}+$/u.test(syllable.plain);
}

/**
 * Parses each reading and keeps only the clean ones (non-empty, every syllable
 * letters-only). Unconverted "xue2 xi2", "qqq9" or "xué," are dropped. Use this
 * list as the candidates for checkTones.
 */
export function cleanReadings(readings: string[]): Syllable[][] {
	return readings.map(parsePinyin).filter((syllables) => syllables.length > 0 && syllables.every(isClean));
}

/** Tone practice needs a tonal language (its profile) and at least one clean pinyin reading. */
export function eligibleForTone(language: string, pinyinReadings: string[]): boolean {
	return profileOf(language).tones && cleanReadings(pinyinReadings).length > 0;
}

/** The pinyin reading values of an entry, in order. */
export function pinyinReadings(readings: readonly { type: string; value: string }[]): string[] {
	return readings.filter((reading) => reading.type === 'pinyin').map((reading) => reading.value);
}

export interface ToneVerdict {
	correct: boolean;
	wrong: number;
	/** Per syllable: right against the best matching reading. */
	marks: boolean[];
	/** The reading the answer was checked against, null when none fits. */
	best: Syllable[] | null;
}

/**
 * toneVerdict checks chosen tones against every reading with the same
 * syllable count (cleanReadings output) and keeps the closest one, so a
 * polyphone answer for any of its readings is right. Ties keep the first.
 */
export function toneVerdict(
	chosen: readonly Tone[],
	candidates: readonly (readonly Syllable[])[]
): ToneVerdict {
	let best: readonly Syllable[] | null = null;
	let bestWrong = chosen.length;
	for (const candidate of candidates) {
		if (candidate.length !== chosen.length) continue;
		const wrong = candidate.reduce((sum, syllable, i) => sum + (syllable.tone === chosen[i] ? 0 : 1), 0);
		if (best === null || wrong < bestWrong) {
			best = candidate;
			bestWrong = wrong;
		}
	}
	if (best === null) {
		return { correct: false, wrong: chosen.length, marks: chosen.map(() => false), best: null };
	}
	const reading = best;
	return {
		correct: bestWrong === 0,
		wrong: bestWrong,
		marks: chosen.map((tone, i) => reading[i].tone === tone),
		best: [...reading]
	};
}

/**
 * The Han characters of `written` when every character is Han and their
 * count equals the syllable count; otherwise null (erhua such as 花儿,
 * mixed scripts), and the pads show toneless pinyin instead.
 */
export function tonePadLabels(written: string, syllableCount: number): string[] | null {
	const chars = [...written.trim()];
	if (chars.length === 0 || chars.length !== syllableCount) return null;
	return chars.every(isHan) ? chars : null;
}

/** The tone check candidates of an entry: its clean pinyin readings. */
export function toneCandidates(readings: readonly { type: string; value: string }[]): Syllable[][] {
	return cleanReadings(pinyinReadings(readings));
}
