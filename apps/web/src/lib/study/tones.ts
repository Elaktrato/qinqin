import type { ReviewGrade } from './types';

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

/**
 * Maps a swipe to a tone. Coordinates are screen coordinates: x grows to the
 * right and y grows DOWNWARD, so "up" is a negative dy.
 *
 * Overload 1, `(dx, dy, minDistance?)`: a single vector.
 *  - shorter than `minDistance` (px, default 24): tap, neutral (5)
 *  - up and up-left (67.5 to 157.5 degrees from the x axis, y flipped): 1
 *  - up-right and right (-22.5 to 67.5 degrees): 2
 *  - down-right, down, down-left, left: 4
 * A dip (tone 3) cannot be told from one vector.
 *
 * Overload 2, `(path, minDistance?)`: the sampled pointer path. A path that
 * first goes down by at least `minDistance` and then comes back up by at least
 * `minDistance` (the lowest point, largest y, lies strictly inside the path)
 * is a dip: 3. Any other path is classified by its start-to-end vector.
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
	const angle = (Math.atan2(-dy, dx) * 180) / Math.PI; // 0 = right, 90 = up
	if (angle >= 67.5 && angle <= 157.5) return 1;
	if (angle >= -22.5 && angle < 67.5) return 2;
	return 4;
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

/** Tone practice needs Chinese and at least one clean pinyin reading. */
export function eligibleForTone(language: string, pinyinReadings: string[]): boolean {
	const base = language.toLowerCase().split(/[-_]/)[0];
	return base === 'zh' && cleanReadings(pinyinReadings).length > 0;
}
