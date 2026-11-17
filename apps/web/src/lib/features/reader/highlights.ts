// Highlights of a library book, as pure helpers for the reader. A highlight
// is anchored by (chapter, paragraph, start, end): code points [start,end)
// of the paragraph's DISPLAYED plain text, i.e. paragraphString(runs) of
// the variant-converted runs, never the ruby. These are the coordinates
// dom.ts selectionSpan and the lookup already use, so a selection maps to
// a highlight without conversion.
import type { Highlight, HighlightColor } from '$lib/api/types';
import { sliceCodePoints, type Run } from './paragraphText';

export type { Highlight, HighlightColor };

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];

/** MAX_NOTE_RUNES is the server's note limit, in code points. */
export const MAX_NOTE_RUNES = 2000;
/** MAX_SNAPSHOT_RUNES is the server's limit for the text snapshot, in code points. */
export const MAX_SNAPSHOT_RUNES = 500;

export function isHighlightColor(value: unknown): value is HighlightColor {
	return typeof value === 'string' && (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}

const cpLength = (text: string) => Array.from(text).length;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// Go's unicode.IsSpace, which the server's strings.TrimSpace check uses
// (JS \s differs: it includes U+FEFF and lacks U+0085).
const SPACE = /^[\t\n\v\f\r\u0085\p{Z}]$/u;

export type HighlightBodyResult =
	| { tooLong: false; body: { start: number; end: number; text: string; color: HighlightColor } }
	| { tooLong: true }
	| null;

/**
 * buildHighlightBody turns code points [start,end) of a paragraph's plain
 * text into what a new highlight stores: edge whitespace is dropped by
 * MOVING start and end (the server refuses a snapshot with edge whitespace
 * and one whose length is not end - start), and `text` is exactly the
 * slice. Null when nothing but whitespace is selected; `tooLong` when the
 * trimmed span has more than MAX_SNAPSHOT_RUNES code points.
 */
export function buildHighlightBody(
	paragraphText: string,
	start: number,
	end: number,
	color: HighlightColor
): HighlightBodyResult {
	const cps = Array.from(paragraphText);
	let from = clamp(Math.min(start, end), 0, cps.length);
	let to = clamp(Math.max(start, end), 0, cps.length);
	while (from < to && SPACE.test(cps[from])) from++;
	while (to > from && SPACE.test(cps[to - 1])) to--;
	if (to <= from) return null;
	if (to - from > MAX_SNAPSHOT_RUNES) return { tooLong: true };
	return { tooLong: false, body: { start: from, end: to, text: cps.slice(from, to).join(''), color } };
}

const byStart = (a: Highlight, b: Highlight) => a.start - b.start || a.end - b.end || a.id - b.id;

/**
 * visibleHighlights sorts the highlights of `chapter` into those to draw
 * (per paragraph, by start) and those whose text changed: the paragraph is
 * missing, the span runs past its end, or its slice is no longer exactly
 * the snapshot (for example after the variant converter changed the text).
 * Changed highlights are listed, never drawn and never deleted. A
 * highlight overlapping one already drawn (the server forbids it) counts as
 * changed, so no character is ever drawn twice.
 */
export function visibleHighlights(
	highlights: Highlight[],
	chapter: number,
	paragraphText: (p: number) => string | null
): { drawn: Map<number, Highlight[]>; changed: Highlight[] } {
	const drawn = new Map<number, Highlight[]>();
	const changed: Highlight[] = [];
	const ordered = highlights
		.filter((h) => h.chapter === chapter)
		.sort((a, b) => a.paragraph - b.paragraph || byStart(a, b));
	for (const h of ordered) {
		const text = paragraphText(h.paragraph);
		const ok =
			text !== null &&
			h.start >= 0 &&
			h.end > h.start &&
			h.end <= cpLength(text) &&
			sliceCodePoints(text, h.start, h.end) === h.text;
		const row = drawn.get(h.paragraph);
		const last = row?.[row.length - 1];
		if (!ok || (last && h.start < last.end)) {
			changed.push(h);
			continue;
		}
		if (row) row.push(h);
		else drawn.set(h.paragraph, [h]);
	}
	return { drawn, changed };
}

/**
 * Seg is a piece of one run: `text` is a slice of the run's displayed
 * text, `startInRun` its start in that text in UTF-16 units (what a DOM
 * text node offset counts, so offsetFromRun(runs, run, startInRun + k)
 * maps a caret inside the piece), `ruby` only on the first piece of a run.
 */
export interface Seg {
	run: number;
	text: string;
	startInRun: number;
	ruby?: string;
	highlight: Highlight | null;
}

/**
 * splitRunsByHighlights cuts a paragraph's runs at the boundaries of its
 * highlights (code points of the plain text, ruby never counted). The
 * segment texts concatenated are the paragraph's plain text; every run
 * yields at least one segment (an empty run one empty segment). Highlights
 * that are empty, start past the end or overlap an earlier one are
 * ignored; one running past the end is cut there. `cuts` are extra
 * paragraph code-point positions where segments are also split (the edges
 * of generated readings); a cut never changes which highlight a segment has.
 */
export function splitRunsByHighlights(runs: Run[], highlights: Highlight[], cuts: readonly number[] = []): Seg[] {
	const total = runs.reduce((n, run) => n + cpLength(run.text), 0);
	const spans: { start: number; end: number; h: Highlight }[] = [];
	for (const h of [...highlights].sort(byStart)) {
		const start = Math.max(h.start, 0);
		const end = Math.min(h.end, total);
		if (end <= start) continue;
		const prev = spans[spans.length - 1];
		if (prev && start < prev.end) continue;
		spans.push({ start, end, h });
	}

	const segs: Seg[] = [];
	let base = 0;
	let next = 0;
	runs.forEach((run, r) => {
		const cps = Array.from(run.text);
		const runEnd = base + cps.length;
		let pos = base;
		let utf16 = 0;
		const push = (to: number, highlight: Highlight | null) => {
			const text = cps.slice(pos - base, to - base).join('');
			const seg: Seg = { run: r, text, startInRun: utf16, highlight };
			if (utf16 === 0 && pos === base && run.ruby !== undefined) seg.ruby = run.ruby;
			segs.push(seg);
			utf16 += text.length;
			pos = to;
		};
		if (cps.length === 0) push(base, null);
		while (pos < runEnd) {
			while (next < spans.length && spans[next].end <= pos) next++;
			const span = spans[next];
			const cut = cuts.find((c) => c > pos);
			const stop = (to: number) => Math.min(to, runEnd, cut ?? Infinity);
			if (span && span.start <= pos) push(stop(span.end), span.h);
			else push(stop(span ? span.start : runEnd), null);
		}
		base = runEnd;
	});
	return segs;
}

/**
 * overlaps is the highlight sharing at least one code point with
 * [start,end) of `paragraph` (adjacent spans do not overlap), if any. Pass
 * `chapter` when the list holds more than one chapter. An empty span
 * (start === end) works as a point query: the highlight with that point
 * strictly inside (not at one of its edges).
 */
export function overlaps(
	highlights: Highlight[],
	paragraph: number,
	start: number,
	end: number,
	chapter?: number
): Highlight | null {
	return (
		highlights.find(
			(h) =>
				h.paragraph === paragraph &&
				(chapter === undefined || h.chapter === chapter) &&
				h.start < end &&
				start < h.end
		) ?? null
	);
}
