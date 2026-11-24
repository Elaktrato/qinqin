// The cloze card's pure logic: which sentence of a word is shown, where
// the blanks are, what the prompt and the accepted answers look like.
// Offsets are code points (as /api/segment returns them), never UTF-16.
// Rule and fixture: docs/contracts/cards/.

import type { ReviewGrade } from './types';
import { shuffleTokens, type SaladTier } from './wordSalad';

/** A half-open range of code points. */
export interface Span {
	start: number;
	end: number;
}

/** A string run, or an extra (non-answer) gap with its own surface text. */
export type ClozePart = string | { gap: true; answer?: string };

export interface ClozePrompt {
	before: ClozePart[];
	after: ClozePart[];
	answer: string;
}

export interface SegmentLike {
	start: number;
	end: number;
	entries: readonly { id: number }[];
}

/** Sorted, in-range, non-overlapping spans of positive length. */
function clean(spans: readonly Span[], length: number): Span[] {
	const valid = spans.filter(
		(s) =>
			Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end <= length && s.end > s.start
	);
	valid.sort((a, b) => a.start - b.start || b.end - a.end);
	const out: Span[] = [];
	let cursor = 0;
	for (const span of valid) {
		if (span.start < cursor) continue;
		out.push(span);
		cursor = span.end;
	}
	return out;
}

/** Non-overlapping leftmost occurrences of the candidates (longest first) as code-point spans. */
function literalSpans(chars: readonly string[], candidates: readonly string[]): Span[] {
	const found: Span[] = [];
	const taken = (start: number, end: number) => found.some((s) => start < s.end && end > s.start);
	const ordered = [...new Set(candidates.filter((c) => c !== ''))]
		.map((text) => ({ text, cps: [...text] }))
		.sort((a, b) => b.cps.length - a.cps.length);
	for (const { cps } of ordered) {
		for (let at = 0; at + cps.length <= chars.length; at++) {
			if (!cps.every((cp, i) => chars[at + i] === cp)) continue;
			if (taken(at, at + cps.length)) continue;
			found.push({ start: at, end: at + cps.length });
			at += cps.length - 1;
		}
	}
	return found.sort((a, b) => a.start - b.start);
}

const HAN = /\p{Script=Han}/u;

/**
 * blankSpans: the segmenter matches that resolve to the entry (for a word
 * written with Han, a kana-only match only when the entry is its first
 * candidate); without
 * any, the literal occurrences of its written form and form texts.
 */
export function blankSpans(
	text: string,
	entry: { id: number; written: string; forms?: readonly { text: string }[] },
	matches: readonly SegmentLike[]
): Span[] {
	const chars = [...text];
	const hanWord = HAN.test(entry.written);
	// A kana-only surface of a word written with Han (はし for 橋) is a homophone
	// unless the segmenter ranks the entry first for it (#186).
	const resolves = (m: SegmentLike) =>
		hanWord && !HAN.test(chars.slice(m.start, m.end).join('')) ? m.entries[0]?.id === entry.id : m.entries.some((e) => e.id === entry.id);
	const matched = clean(
		matches.filter(resolves).map((m) => ({ start: m.start, end: m.end })),
		chars.length
	);
	if (matched.length > 0) return matched;
	// The segmenter answered but not for this entry: an occurrence lying inside
	// a strictly longer match (中国 in 中国人) is part of another word.
	return literalSpans(chars, [entry.written, ...(entry.forms ?? []).map((f) => f.text)]).filter(
		(span) =>
			!matches.some(
				(m) =>
					m.start <= span.start &&
					m.end >= span.end &&
					m.end - m.start > span.end - span.start
			)
	);
}

/** How many of an entry's sentences a cloze card ever considers. */
export const CLOZE_CANDIDATES = 8;

/** The first CLOZE_CANDIDATES non-blank sentences in their given order. */
export function clozeCandidates<S extends { hanzi: string }>(sentences: readonly S[]): S[] {
	return sentences.filter((s) => s.hanzi.trim() !== '').slice(0, CLOZE_CANDIDATES);
}

/** The sentences with at least one blank, in their given order. */
export function eligibleSentences<S extends { id: number; hanzi: string }>(
	sentences: readonly S[],
	spansOf: (sentence: S) => Span[]
): S[] {
	return sentences.filter((s) => s.hanzi.trim() !== '' && spansOf(s).length > 0);
}

/** The sentence of this showing: `eligible[n mod length]`; null when none. */
export function sentenceForShowing<S>(eligible: readonly S[], recordedReviews: number): S | null {
	if (eligible.length === 0) return null;
	const n = Number.isInteger(recordedReviews) && recordedReviews > 0 ? recordedReviews : 0;
	return eligible[n % eligible.length];
}

export interface ClozeShowing<S> {
	sentence: S;
	spans: Span[];
	prompt: ClozePrompt;
}

/**
 * resolveClozeShowing picks what one showing of the card displays: the
 * sentence (the `fixedSentenceId` of an Again re-show while it is still
 * eligible, else the rotation over `recorded` reviews), its blanks and
 * its prompt. Null when no sentence has a blank.
 */
export function resolveClozeShowing<S extends { id: number; hanzi: string }>(input: {
	entry: { id: number; written: string; forms?: readonly { text: string }[] };
	sentences: readonly S[];
	matchesOf: (sentence: S) => readonly SegmentLike[];
	recorded: number;
	fixedSentenceId?: number;
}): ClozeShowing<S> | null {
	const spansOf = (sentence: S) => blankSpans(sentence.hanzi, input.entry, input.matchesOf(sentence));
	const eligible = eligibleSentences(clozeCandidates(input.sentences), spansOf);
	const fixed =
		input.fixedSentenceId === undefined
			? undefined
			: eligible.find((sentence) => sentence.id === input.fixedSentenceId);
	const sentence = fixed ?? sentenceForShowing(eligible, input.recorded);
	if (sentence === null) return null;
	const spans = spansOf(sentence);
	return { sentence, spans, prompt: clozePrompt(sentence.hanzi, spans) };
}

/** The prompt around the first span; later spans become extra gaps. */
export function clozePrompt(text: string, spans: readonly Span[]): ClozePrompt {
	const chars = [...text];
	const sorted = clean(spans, chars.length);
	if (sorted.length === 0) return { before: [text], after: [], answer: '' };
	const slice = (from: number, to: number) => chars.slice(from, to).join('');
	const first = sorted[0];
	const before: ClozePart[] = [];
	if (first.start > 0) before.push(slice(0, first.start));
	const after: ClozePart[] = [];
	let cursor = first.end;
	for (const span of sorted.slice(1)) {
		if (span.start > cursor) after.push(slice(cursor, span.start));
		after.push({ gap: true, answer: slice(span.start, span.end) });
		cursor = span.end;
	}
	if (cursor < chars.length) after.push(slice(cursor, chars.length));
	return { before, after, answer: slice(first.start, first.end) };
}

export type ClozeMode = 'choose' | 'type';

/**
 * Choose at tier 0 when the answer is the written form or a form (not an
 * inflection) and three distractors exist; type otherwise.
 */
export function clozeMode(input: {
	tier: SaladTier;
	answer: string;
	entryForms: readonly string[];
	distractors: readonly string[];
}): ClozeMode {
	const plain = input.entryForms.some((form) => normalizeAnswer(form) === normalizeAnswer(input.answer));
	return input.tier === 0 && plain && input.distractors.length >= 3 ? 'choose' : 'type';
}

const length = (text: string) => [...text].length;

/** Up to three wrong choices: same length first, none in the sentence, deterministic. */
export function pickDistractors(input: {
	answer: string;
	sentence: string;
	candidates: readonly string[];
	seed: string;
}): string[] {
	const pool = [...new Set(input.candidates)]
		.filter((c) => c !== '' && c !== input.answer && !input.sentence.includes(c))
		.sort();
	const same = shuffleTokens(
		pool.filter((c) => length(c) === length(input.answer)),
		input.seed
	);
	const other = shuffleTokens(
		pool.filter((c) => length(c) !== length(input.answer)),
		input.seed
	);
	return [...same, ...other].slice(0, 3);
}

/** NFC, trimmed, inner whitespace removed. */
export function normalizeAnswer(text: string): string {
	return text.normalize('NFC').replace(/\s+/gu, '');
}

/** The accepted answers: the surface, plus every form when the surface is a plain one. */
export function acceptedClozeAnswers(
	answer: string,
	entry: {
		written: string;
		forms?: readonly { text: string }[];
		variants?: readonly { written: string }[];
	}
): Set<string> {
	const accepted = new Set([normalizeAnswer(answer)]);
	const all = [
		entry.written,
		...(entry.forms ?? []).map((f) => f.text),
		...(entry.variants ?? []).map((v) => v.written)
	]
		.map(normalizeAnswer)
		.filter((text) => text !== '');
	const plain = [entry.written, ...(entry.forms ?? []).map((f) => f.text)].map(normalizeAnswer);
	if (plain.includes(normalizeAnswer(answer))) for (const text of all) accepted.add(text);
	return accepted;
}

/** Good for a right answer, Again otherwise; never Easy. */
export function suggestClozeGrade(result: { correct: boolean; gaveUp: boolean }): ReviewGrade {
	return result.correct && !result.gaveUp ? 3 : 1;
}
