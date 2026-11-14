// The book sentence a looked-up word was found in. Adding a word to study
// from the reader saves that sentence as the user's example sentence of
// the entry (so the review front and Word Salad can show it in context).
// Offsets are code points, as in the lookup results.

/** The longest sentence kept, in code points (a window around the word). */
export const SENTENCE_MAX = 200;

const TERMINATORS = new Set(['。', '！', '？', '．', '!', '?', '…', '‼', '⁇', '⁈', '⁉']);
const ELLIPSIS = '…';
// Quote marks and brackets: full stops inside them do not end a sentence;
// the sentence ends after the mark that closes them.
const OPEN = new Set(['「', '『', '“', '‘', '《', '〈', '（', '(', '【', '〔']);
const CLOSE = new Set(['」', '』', '”', '’', '》', '〉', '）', ')', '】', '〕']);
// Straight quotes cannot be told open from close; after a full stop they close.
const STRAIGHT_QUOTES = new Set(['"', "'"]);

const SPACE = /\s/u;
const NEWLINE = /[\n\r\u2028\u2029]/u;

function isCloser(ch: string): boolean {
	return CLOSE.has(ch) || STRAIGHT_QUOTES.has(ch);
}

/**
 * isTerminator: sentence-final punctuation at i. An ASCII full stop counts
 * only before a space, a closing mark or the end ("3.5" does not split;
 * "Mr. Smith" does, a known limitation).
 */
function isTerminator(cps: string[], i: number): boolean {
	const ch = cps[i];
	if (TERMINATORS.has(ch)) return true;
	if (ch !== '.') return false;
	const next = cps[i + 1];
	return next === undefined || SPACE.test(next) || isCloser(next);
}

/**
 * sentenceEnds returns the code-point offsets where sentences end (the
 * last is the paragraph length). Rules:
 * - a run of terminators plus the closing marks right after it ends a
 *   sentence when no quotation or bracket is left open, even if text
 *   follows ("「行こう。」と言った。" is two sentences);
 * - terminators inside an open quotation or bracket never split;
 * - a run made only of ellipses ("……") ends a sentence only before a
 *   closing mark, whitespace or the end: mid-sentence pauses are common;
 * - a line break always ends a sentence (and forgets open quotes).
 */
function sentenceEnds(cps: string[]): number[] {
	const ends: number[] = [];
	let depth = 0; // open quotes and brackets
	let i = 0;
	while (i < cps.length) {
		const ch = cps[i];
		if (NEWLINE.test(ch)) {
			depth = 0;
			ends.push(i + 1);
			i++;
			continue;
		}
		if (OPEN.has(ch)) depth++;
		else if (CLOSE.has(ch)) depth = Math.max(0, depth - 1);
		if (!isTerminator(cps, i)) {
			i++;
			continue;
		}
		let j = i + 1;
		while (j < cps.length && isTerminator(cps, j)) j++;
		const onlyEllipsis = cps.slice(i, j).every((c) => c === ELLIPSIS);
		const afterRun = cps[j];
		// Closing marks right after the full stop stay with its sentence.
		while (j < cps.length && isCloser(cps[j])) {
			if (!STRAIGHT_QUOTES.has(cps[j])) depth = Math.max(0, depth - 1);
			j++;
		}
		const pause =
			onlyEllipsis && afterRun !== undefined && !SPACE.test(afterRun) && !isCloser(afterRun);
		if (depth === 0 && !pause) ends.push(j);
		i = j;
	}
	if (ends[ends.length - 1] !== cps.length) ends.push(cps.length);
	return ends;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(Math.max(n, lo), hi);
}

/**
 * sentenceAround returns the sentence of `paragraph` holding the code-point
 * span [start, end): cut at sentence-final punctuation (。！？．!?…, with
 * closing quotes and brackets right after it), line breaks and the
 * paragraph edges, never between a full stop and its closing mark and
 * never inside an open quotation (see sentenceEnds). A sentence longer than SENTENCE_MAX
 * code points is cut to a window of that size around the span. The
 * result is trimmed.
 */
export function sentenceAround(paragraph: string, start: number, end: number): string {
	const cps = Array.from(paragraph);
	const n = cps.length;
	if (n === 0) return '';
	const s = clamp(start, 0, n);
	const e = clamp(Math.max(end, s), s, n);
	const ends = sentenceEnds(cps);

	// The sentence holding the first code point of the span (the last one
	// for a span at the very end), extended to the one holding its last.
	const first = Math.min(s, n - 1);
	const last = Math.max(first, Math.min(e - 1, n - 1));
	const index = ends.findIndex((at) => at > first);
	const a = index > 0 ? ends[index - 1] : 0;
	const b = ends.find((at) => at > last) ?? n;

	let from = a;
	let to = b;
	if (to - from > SENTENCE_MAX) {
		const length = e - s;
		if (length >= SENTENCE_MAX) {
			from = s;
		} else {
			from = clamp(s - Math.floor((SENTENCE_MAX - length) / 2), a, b - SENTENCE_MAX);
		}
		to = from + SENTENCE_MAX;
	}
	return cps.slice(from, to).join('').trim();
}

/**
 * bookSentence is the sentence to save for the span, or '' when there is
 * nothing beyond the word itself (a heading, a one-word line).
 */
export function bookSentence(paragraph: string, start: number, end: number): string {
	const sentence = sentenceAround(paragraph, start, end);
	const word = Array.from(paragraph).slice(start, end).join('').trim();
	return sentence === word ? '' : sentence;
}

/** normalizeSentence collapses whitespace runs to one space and trims. */
export function normalizeSentence(text: string): string {
	return text.replace(/\s+/gu, ' ').trim();
}

/** The calls resolveBookSentence makes (injected for tests). */
export interface SentenceApi {
	getEntry(entryId: number): Promise<{ sentences?: { id: number; hanzi: string }[] | null }>;
	addSentence(entryId: number, hanzi: string): Promise<{ id: number }>;
}

/**
 * resolveBookSentence finds the id of `text` as an example sentence of the
 * entry: an existing sentence with the same text (whitespace-normalised)
 * is reused, else the text is posted as the user's own sentence. It never
 * throws: a failed post gives `failed: true` and no id, so adding the card
 * goes on without the sentence.
 */
export async function resolveBookSentence(
	api: SentenceApi,
	entryId: number,
	text: string
): Promise<{ sentenceId: number | undefined; failed: boolean }> {
	const wanted = normalizeSentence(text);
	if (!wanted) return { sentenceId: undefined, failed: false };
	try {
		const entry = await api.getEntry(entryId);
		const same = (entry.sentences ?? []).find((s) => normalizeSentence(s.hanzi) === wanted);
		if (same) return { sentenceId: same.id, failed: false };
	} catch {
		// Could not check: posting may still work, a duplicate is harmless.
	}
	try {
		const created = await api.addSentence(entryId, wanted);
		return { sentenceId: created.id, failed: false };
	} catch {
		return { sentenceId: undefined, failed: true };
	}
}
