// Checking an answer of the measure-word and counter drills (#179; docs/contracts/counters/check.json). A typed
// answer is read after normalising what the IME or the keyboard gave (width, spaces, case, a final full stop,
// katakana as hiragana). A noun's answer is the measure word or counter itself (a leading number such as 一本 or 三枚
// is ignored), any listed spelling, its kana or romaji (Japanese) or its tone pinyin (Chinese, marks or digits; no
// toneless pinyin). A reading is kana or romaji; text with a kanji or a digit is not graded (the IME converted it).
// The choices never offer a second right answer.

import { parsePinyin } from '$lib/exercises/tones';
import type { CounterMeasure, CounterNoun, CounterReadings, NumberReadings } from './words';

export type Verdict = 'canonical' | 'accepted' | 'fallback' | 'wrong';

/** A random number in [0, 1) (Math.random, or a seeded one in tests). */
export type Rng = () => number;

const KATAKANA = /[ァ-ヶ]/g;

/** normaliseText: NFKC, no white space, lower case, no final full stop or question mark. */
export function normaliseText(text: string): string {
	return text
		.normalize('NFKC')
		.replace(/\s+/gu, '')
		.toLowerCase()
		.replace(/[。．.、,!?！？]+$/u, '');
}

/** hiragana: katakana folded to hiragana. */
export function hiragana(text: string): string {
	return text.replace(KATAKANA, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const MACRONS: Readonly<Record<string, string>> = { ā: 'aa', ī: 'ii', ū: 'uu', ē: 'ee', ō: 'ou', â: 'aa', î: 'ii', û: 'uu', ê: 'ee', ô: 'ou' };

/** romajiKey: romaji compared without case, separators or macrons (ū → uu), m before b/p/m as n (sambon = sanbon). */
export function romajiKey(text: string): string {
	return normaliseText(text)
		.replace(/[āīūēōâîûêô]/g, (c) => MACRONS[c] ?? c)
		.replace(/['’\-.]/g, '')
		.replace(/m(?=[bpm])/g, 'n');
}

const LATIN = /^[a-zāīūēōâîûêôǎǐǒǔǚáíóúǘàìòùǜéèěüv0-9'’\-:]+$/;

/** pinyinKey: typed or stored pinyin as `ben3 ce4` (no mark or digit: the neutral tone 5, so `ben` is not `ben3`). */
export function pinyinKey(text: string): string | null {
	const tokens = text.normalize('NFKC').toLowerCase().trim().split(/[\s'’]+/).filter((t) => t !== '');
	if (tokens.length === 0) return null;
	const out: string[] = [];
	for (const token of tokens) {
		const digit = /^([a-zü:v]+)([0-5])$/.exec(token);
		if (digit !== null) {
			out.push(`${digit[1].replace(/v|u:/g, 'ü')}${digit[2] === '0' ? '5' : digit[2]}`);
			continue;
		}
		const syllables = parsePinyin(token);
		if (syllables.length !== 1) return null;
		out.push(`${syllables[0].plain}${syllables[0].tone}`);
	}
	return out.join(' ');
}

const LEADING_NUMBER = /^[0-9〇零一二两兩三四五六七八九十百千几幾何]+/u;

function spellings(m: CounterMeasure): string[] {
	return [m.written, ...m.variants];
}

function matchesMeasure(typed: string, m: CounterMeasure): boolean {
	if (spellings(m).some((s) => normaliseText(s) === typed || hiragana(normaliseText(s)) === hiragana(typed))) return true;
	for (const r of m.readings) {
		if (r.type === 'kana' && hiragana(r.value) === hiragana(typed)) return true;
		if (r.type === 'romaji' && LATIN.test(typed) && romajiKey(r.value) === romajiKey(typed)) return true;
		if (r.type === 'pinyin' && LATIN.test(typed)) {
			const key = pinyinKey(typed);
			if (key !== null && key === pinyinKey(r.value)) return true;
		}
	}
	return false;
}

/** checkMeasure: a typed answer to a noun drill, or 'unread' when there is nothing to check. */
export function checkMeasure(input: string, noun: CounterNoun): Verdict | 'unread' {
	const typed = normaliseText(input).replace(LEADING_NUMBER, '');
	if (typed === '') return 'unread';
	const index = noun.measures.findIndex((m) => matchesMeasure(typed, m));
	if (index === 0) return 'canonical';
	if (index > 0) return 'accepted';
	if (noun.fallback !== null && matchesMeasure(typed, noun.fallback)) return 'fallback';
	return 'wrong';
}

const NOT_KANA = /[\p{Script=Han}0-9々〆]/u;

/** checkReading: a typed reading, 'kana' when it holds a kanji or a digit (not graded), 'unread' when empty. */
export function checkReading(input: string, item: NumberReadings): Verdict | 'kana' | 'unread' {
	const typed = normaliseText(input);
	if (typed === '') return 'unread';
	if (NOT_KANA.test(typed)) return 'kana';
	const latin = LATIN.test(typed);
	const index = item.answers.findIndex((a) =>
		latin ? a.romaji !== '' && romajiKey(a.romaji) === romajiKey(typed) : hiragana(a.reading) === hiragana(typed)
	);
	return index < 0 ? 'wrong' : index === 0 ? 'canonical' : 'accepted';
}

function shuffled<T>(list: readonly T[], rng: Rng): T[] {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** shownMeasure: how a measure word is written for this noun (traditional for a traditional noun). */
export function shownMeasure(m: CounterMeasure, traditional: boolean): string {
	return traditional && m.variants.length > 0 && m.readings.some((r) => r.type === 'pinyin') ? m.variants[0] : m.written;
}

/** The container measure words, and the ones never offered as wrong to a noun counted by a container (measures.json). */
export const CONTAINERS: readonly string[] = ['杯', '瓶', '碗', '壶', '盒', '盘', '份'];
export const CONTAINER_AVOID: readonly string[] = ['杯', '瓶', '碗', '壶', '盒', '盘', '份', '片', '块', '颗', '口'];

/**
 * nounChoices: the canonical answer and up to three wrong ones from the pool: never a right one, nor 个 as the
 * fallback, nor a character of the noun itself (一门门), nor, for a noun counted by a container (一杯茶), another
 * container or portion word (一瓶茶 is right too).
 */
export function nounChoices(noun: CounterNoun, pool: readonly CounterMeasure[], rng: Rng): string[] {
	const right = noun.measures[0];
	const taken = new Set([...noun.measures, ...(noun.fallback ? [noun.fallback] : [])].flatMap(spellings));
	for (const ch of noun.written) taken.add(ch);
	if (noun.measures.some((m) => spellings(m).some((s) => CONTAINERS.includes(s)))) for (const w of CONTAINER_AVOID) taken.add(w);
	const wrong: string[] = [];
	for (const m of shuffled(pool, rng)) {
		if (spellings(m).some((s) => taken.has(s))) continue;
		const shown = shownMeasure(m, noun.traditional);
		if (wrong.includes(shown)) continue;
		wrong.push(shown);
		if (wrong.length === 3) break;
	}
	return shuffled([right.written, ...wrong], rng);
}

/** readingChoices: the canonical reading, the item's mistakes first, then other numbers' readings; no accepted one. */
export function readingChoices(item: NumberReadings, counter: CounterReadings, rng: Rng): string[] {
	const right = item.answers[0].reading;
	const accepted = new Set(item.answers.map((a) => a.reading));
	const others = counter.numbers.filter((n) => n.number !== item.number).map((n) => n.answers[0].reading);
	const wrong: string[] = [];
	for (const r of [...shuffled(item.mistakes.map((m) => m.reading), rng), ...shuffled(others, rng)]) {
		if (accepted.has(r) || wrong.includes(r)) continue;
		wrong.push(r);
		if (wrong.length === 3) break;
	}
	return shuffled([right, ...wrong], rng);
}
