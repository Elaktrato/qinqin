// Word Salad: pure tokenising, tiering, shuffling and grading logic. No UI.
// All offsets and splitting work in code points, never UTF-16 units.

import { profileOf } from '$lib/languages/profiles';
import type { ReviewGrade } from '$lib/studycore/types';

/** 0 = whole words, 1 = words (stability >= 4), 2 = single characters (>= 21). */
export type SaladTier = 0 | 1 | 2;

export function tierFor(stability: number | null): SaladTier {
	if (stability === null || Number.isNaN(stability)) return 0;
	if (stability >= 21) return 2;
	if (stability >= 4) return 1;
	return 0;
}

/**
 * MatchSpan is a code-point range [start, end) into the segmented text.
 * The API's SegmentMatch (apps/web/src/lib/api/types.ts) is structurally
 * assignable, so `segmentBatch` fits loadTokens' injected `segment` parameter
 * with the trivial adapter `(l, t) => segmentBatch(l, t)` (keeps the optional
 * AbortSignal argument out of the call).
 */
export interface MatchSpan {
	start: number;
	end: number;
}

// Closing/final/other punctuation and dashes (ASCII and full-width) attach to
// the previous token. Opening brackets and quotes (Ps, Pi: 「 『 （ ( “) attach
// FORWARD to the next token instead. Straight ASCII quotes " and ' are Po, so
// they are ambiguous and always attach backward.
const TRAILING_PUNCT = /^[\p{Pe}\p{Pf}\p{Po}\p{Pd}～〜]+$/u;
const OPENING_PUNCT = /^[\p{Ps}\p{Pi}]+$/u;

function isTrailingPunct(token: string): boolean {
	return TRAILING_PUNCT.test(token);
}

function isOpeningPunct(token: string): boolean {
	return OPENING_PUNCT.test(token);
}

/** A language whose words are found by dictionary segmentation, not spaces (its profile, #199). */
function isCjk(language: string): boolean {
	return profileOf(language).segmentation === 'dictionary';
}

const WHITESPACE = /^\s+$/u;

/** Sorted, non-overlapping, in-range, integer spans with positive length. */
function sanitiseSpans(matches: MatchSpan[], length: number): MatchSpan[] {
	const valid = (Array.isArray(matches) ? matches : []).filter(
		(m) =>
			m !== null &&
			typeof m === 'object' &&
			Number.isInteger(m.start) &&
			Number.isInteger(m.end) &&
			m.start >= 0 &&
			m.end <= length &&
			m.end > m.start
	);
	valid.sort((a, b) => a.start - b.start || b.end - a.end);
	const out: MatchSpan[] = [];
	let cursor = 0;
	for (const m of valid) {
		if (m.start < cursor) continue;
		out.push(m);
		cursor = m.end;
	}
	return out;
}

/**
 * Closing punctuation tokens attach to the previous token, opening ones to the
 * next (consecutive openers merge); a trailing orphan opener attaches to the
 * previous token.
 */
function attachPunctuation(tokens: string[]): string[] {
	const out: string[] = [];
	let pending = '';
	for (const token of tokens) {
		if (isOpeningPunct(token)) {
			pending += token;
		} else if (pending === '' && out.length > 0 && isTrailingPunct(token)) {
			out[out.length - 1] += token;
		} else {
			out.push(pending + token);
			pending = '';
		}
	}
	if (pending !== '') {
		if (out.length > 0) out[out.length - 1] += pending;
		else out.push(pending);
	}
	return out;
}

const isAsciiAlnum = (c: string | undefined) => c !== undefined && /^[A-Za-z0-9]$/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && /^[0-9]$/.test(c);

export function tokenize(language: string, text: string, matches: MatchSpan[]): string[] {
	if (!isCjk(language)) {
		return text.split(/\s+/u).filter((t) => t !== '');
	}
	const points = Array.from(text);
	const raw: string[] = [];
	const pushGap = (from: number, to: number) => {
		let i = from;
		while (i < to) {
			if (isAsciiAlnum(points[i])) {
				// Keep Latin letter/digit runs (and 3.14 style numbers) together.
				let j = i + 1;
				while (
					j < to &&
					(isAsciiAlnum(points[j]) ||
						((points[j] === '.' || points[j] === ',') &&
							isDigit(points[j - 1]) &&
							j + 1 < to &&
							isDigit(points[j + 1])))
				)
					j++;
				raw.push(points.slice(i, j).join(''));
				i = j;
				continue;
			}
			if (!WHITESPACE.test(points[i])) raw.push(points[i]);
			i++;
		}
	};
	let cursor = 0;
	for (const span of sanitiseSpans(matches, points.length)) {
		pushGap(cursor, span.start);
		const surface = points.slice(span.start, span.end).join('');
		if (surface.trim() !== '') raw.push(surface.replace(/\s+/gu, ''));
		cursor = span.end;
	}
	pushGap(cursor, points.length);
	return attachPunctuation(raw);
}

/** Tier 2: every token into single code points, punctuation kept with its character. */
export function splitWithin(tokens: string[]): string[] {
	return tokens.flatMap((token) => attachPunctuation(Array.from(token)));
}

// xmur3 string hash + mulberry32 PRNG: small, fast, deterministic.
function seedFrom(seed: string): number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	h = Math.imul(h ^ (h >>> 16), 2246822507);
	h = Math.imul(h ^ (h >>> 13), 3266489909);
	return (h ^= h >>> 16) >>> 0;
}

function mulberry32(a: number): () => number {
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function sameOrder<T>(a: T[], b: T[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Deterministic seeded shuffle. When at least two distinct values exist the
 * result is guaranteed to differ (by value) from the input order.
 */
export function shuffleTokens<T>(items: T[], seed: string): T[] {
	const result = [...items];
	if (result.length < 2) return result;
	const rand = mulberry32(seedFrom(seed));
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	if (!sameOrder(result, items)) return result;
	const other = items.findIndex((v) => v !== items[0]);
	if (other === -1) return result; // all values equal: no different order exists
	[result[0], result[other]] = [result[other], result[0]];
	return result;
}

export function isCorrect(answer: string[], solution: string[]): boolean {
	return sameOrder(answer, solution);
}

export function suggestSaladGrade(args: { wrongChecks: number; revealed: boolean }): ReviewGrade {
	if (args.revealed || args.wrongChecks >= 3) return 1;
	if (args.wrongChecks >= 1) return 2;
	return 3;
}

/**
 * Segments `text` through the injected function and tokenises it. On any
 * failure (rejection, sync throw, malformed result) it falls back to the
 * per-character tokenisation.
 */
export async function loadTokens(
	language: string,
	text: string,
	segment: (lang: string, text: string) => Promise<MatchSpan[]>
): Promise<string[]> {
	try {
		const matches = await segment(language, text);
		if (!Array.isArray(matches)) return tokenize(language, text, []);
		return tokenize(language, text, matches);
	} catch {
		return tokenize(language, text, []);
	}
}
