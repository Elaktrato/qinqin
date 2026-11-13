// The book sentence a looked-up word was found in. Adding a word to study
// from the reader saves that sentence as the user's example sentence of
// the entry (so the review front and Word Salad can show it in context).
// Offsets are code points, as in the lookup results.

/** The longest sentence kept, in code points (a window around the word). */
export const SENTENCE_MAX = 200;

const TERMINATORS = new Set(['。', '！', '？', '．', '!', '?', '…', '‼', '⁇', '⁈', '⁉']);
// Quote marks: a sentence quoted inside narration ("「行こう。」と言った")
// stays one sentence with the narration that follows it.
const QUOTE_OPEN = new Set(['「', '『', '“', '‘', '《', '〈']);
const QUOTE_CLOSE = new Set(['」', '』', '”', '’', '》', '〉']);
// Brackets: their content may end with a full stop, and the sentence ends
// after the bracket.
const BRACKET_OPEN = new Set(['（', '(', '【', '〔']);
const BRACKET_CLOSE = new Set(['）', ')', '】', '〕']);
// Straight quotes cannot be told open from close; after a full stop they close.
const STRAIGHT_QUOTES = new Set(['"', "'"]);

const SPACE = /\s/u;

function isCloser(ch: string): boolean {
	return QUOTE_CLOSE.has(ch) || BRACKET_CLOSE.has(ch) || STRAIGHT_QUOTES.has(ch);
}

function isOpener(ch: string): boolean {
	return QUOTE_OPEN.has(ch) || BRACKET_OPEN.has(ch);
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

/** sentenceEnds returns the code-point offsets where sentences end (the last is the paragraph length). */
function sentenceEnds(cps: string[]): number[] {
	const ends: number[] = [];
	let depth = 0; // open quotes and brackets
	let i = 0;
	while (i < cps.length) {
		const ch = cps[i];
		if (isOpener(ch)) depth++;
		else if (QUOTE_CLOSE.has(ch) || BRACKET_CLOSE.has(ch)) depth = Math.max(0, depth - 1);
		if (!isTerminator(cps, i)) {
			i++;
			continue;
		}
		const quoted = depth > 0;
		let j = i + 1;
		while (j < cps.length && isTerminator(cps, j)) j++;
		// Closing marks right after the full stop stay with its sentence.
		let lastClose = '';
		while (j < cps.length && isCloser(cps[j])) {
			lastClose = cps[j];
			if (!STRAIGHT_QUOTES.has(lastClose)) depth = Math.max(0, depth - 1);
			j++;
		}
		const next = cps[j];
		let boundary: boolean;
		if (depth > 0) {
			// Still inside a quotation or bracket: its sentences are one unit.
			boundary = false;
		} else if (quoted && QUOTE_CLOSE.has(lastClose)) {
			// A quotation just closed: narration may continue ("」と言った").
			boundary = next === undefined || SPACE.test(next) || isOpener(next);
		} else {
			boundary = true;
		}
		if (boundary) ends.push(j);
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
 * closing quotes and brackets right after it) and the paragraph edges,
 * never between a full stop and its closing mark, and never inside a
 * quotation that narration continues. A sentence longer than SENTENCE_MAX
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
