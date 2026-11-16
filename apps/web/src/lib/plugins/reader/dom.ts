// DOM side of the paragraph mapping. ChapterText renders each paragraph as
// <p data-p="i"> and each run as an element with data-r="j" whose FIRST
// text node is the run's displayed text; a shown furigana lives in an <rt>
// after it. In a paragraph with highlights or generated readings a run's
// text is cut into pieces instead: child <span>/<mark>/<ruby> elements
// with data-o = the piece's UTF-16 start in the run, all before the run's
// own <rt>; a generated <ruby> piece keeps its <rt> inside, after the base
// text node, so a piece's length is that of its first text node. Everything here maps DOM boundary points onto that model and
// back; the arithmetic itself lives in paragraphText.ts. The last two
// helpers serve Shift+hover scanning inside the lookup popups.
import { codePointToUtf16, utf16ToCodePoint } from './lookup';
import { locate, offsetFromRun, paragraphString, segmentAt, type Run } from './paragraphText';

export interface RunPoint {
	p: number;
	r: number;
	utf16: number;
	inRt: boolean;
}

export type RunsOf = (p: number) => Run[] | undefined;

function elementOf(node: Node): Element | null {
	return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/**
 * A piece of a run's displayed text: either the run's own (first) text
 * node, or, in a paragraph with highlights, one child element per piece
 * (a <span> or <mark> with data-o = its UTF-16 start in the run).
 */
interface Piece {
	node: Text | null;
	el: Element;
	o: number;
	length: number;
}

function firstText(el: Element): Text | null {
	for (const child of el.childNodes) if (child.nodeType === Node.TEXT_NODE) return child as Text;
	return null;
}

function isPiece(node: Node): node is Element {
	return node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute('data-o');
}

function piecesOf(run: Element): Piece[] {
	const out: Piece[] = [];
	for (const child of run.childNodes) {
		if (isPiece(child)) {
			const node = firstText(child);
			out.push({ node, el: child, o: Number((child as HTMLElement).dataset.o), length: node?.length ?? 0 });
		}
	}
	if (out.length > 0) return out;
	const node = firstText(run);
	return [{ node, el: run, o: 0, length: node?.length ?? 0 }];
}

function runLength(pieces: Piece[]): number {
	const last = pieces[pieces.length - 1];
	return last ? last.o + last.length : 0;
}

function indexOf(el: Element, attr: 'p' | 'r'): number {
	return Number((el as HTMLElement).dataset[attr]);
}

/** caretFromPoint wraps the standard API and the WebKit/Blink fallback. */
export function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
	if (typeof document.caretPositionFromPoint === 'function') {
		const pos = document.caretPositionFromPoint(x, y);
		return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
	}
	const legacy = (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null })
		.caretRangeFromPoint;
	const range = legacy?.call(document, x, y);
	return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/**
 * runPointAt maps a DOM boundary point inside a run to (paragraph, run,
 * UTF-16 offset in the run's displayed text). A point inside the furigana
 * maps to the start of its base run (or its end, for the end of a range).
 * Null when the point is not inside a run.
 */
export function runPointAt(node: Node, offset: number, bias: 'start' | 'end'): RunPoint | null {
	const el = elementOf(node);
	const run = el?.closest('[data-r]');
	const paragraph = run?.closest('[data-p]');
	if (!el || !run || !paragraph) return null;
	const pieces = piecesOf(run);
	const length = runLength(pieces);
	const p = indexOf(paragraph, 'p');
	const r = indexOf(run, 'r');
	const rt = el.closest('rt');
	if (rt) {
		// A generated reading sits inside its piece: map to that piece's edge.
		const own = pieces.find((piece) => piece.el !== run && piece.el.contains(rt));
		const [from, to] = own ? [own.o, own.o + own.length] : [0, length];
		return { p, r, utf16: bias === 'start' ? from : to, inRt: true };
	}
	const at = (utf16: number): RunPoint => ({ p, r, utf16, inRt: false });
	const text = pieces.find((piece) => piece.node === node);
	if (text) return at(text.o + offset);
	const own = pieces.find((piece) => piece.el === node && piece.el !== run);
	// A piece element itself: before or after its text.
	if (own) return at(offset === 0 ? own.o : own.o + own.length);
	if (node !== run) return at(offset === 0 ? 0 : length);
	// The run element itself: offset counts children before the point; the
	// point sits before the next piece, or at the end before the <rt>.
	const children = run.childNodes;
	for (let i = offset; i < children.length; i++) {
		const child = children[i];
		const piece = pieces.find((pc) => pc.el === child || pc.node === child);
		if (piece) return at(piece.o);
		if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === 'rt') break;
	}
	return at(offset === 0 ? 0 : length);
}

/** paragraphElement finds <p data-p> of the chapter text. */
export function paragraphElement(container: Element, p: number): HTMLElement | null {
	return container.querySelector<HTMLElement>(`[data-p="${p}"]`);
}

/** rangeForSpan builds a DOM range over code points [start,end) of paragraph p. */
export function rangeForSpan(container: Element, p: number, runs: Run[], start: number, end: number): Range | null {
	const paragraph = paragraphElement(container, p);
	if (!paragraph || runs.length === 0) return null;
	const from = locate(runs, start);
	let to = locate(runs, end);
	// End at the close of the previous run, not the start of the next one:
	// the rectangle then never spills onto the next run's line.
	if (end > start && to.utf16Offset === 0 && to.runIndex > 0) {
		to = { runIndex: to.runIndex - 1, utf16Offset: runs[to.runIndex - 1].text.length };
	}
	// The text node and offset holding (run, utf16): with highlights a run
	// is cut into pieces, each with its own text node.
	const pointOf = (r: number, utf16: number, bias: 'start' | 'end') => {
		const run = paragraph.querySelector(`[data-r="${r}"]`);
		if (!run) return null;
		const pieces = piecesOf(run);
		const hit = segmentAt(pieces, utf16, bias);
		const piece = hit && pieces[hit.index];
		if (!hit || !piece?.node) return null;
		return { node: piece.node, offset: Math.min(hit.offset, piece.node.length) };
	};
	const startPoint = pointOf(from.runIndex, from.utf16Offset, 'start');
	const endPoint = pointOf(to.runIndex, to.utf16Offset, end > start ? 'end' : 'start');
	if (!startPoint || !endPoint) return null;
	const range = document.createRange();
	range.setStart(startPoint.node, startPoint.offset);
	range.setEnd(endPoint.node, endPoint.offset);
	return range;
}

/** rangeContainsPoint reports whether any line box of the range holds (x, y). */
export function rangeContainsPoint(range: Range, x: number, y: number): boolean {
	for (const rect of range.getClientRects()) {
		if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) {
			return true;
		}
	}
	return false;
}

// A boundary inside paragraph `paragraph` that may sit between runs: the
// offset is the start of the first run at or after it.
function boundaryOffset(
	paragraph: HTMLElement,
	runs: Run[],
	node: Node,
	offset: number,
	bias: 'start' | 'end'
): number {
	const point = runPointAt(node, offset, bias);
	const p = indexOf(paragraph, 'p');
	if (point && point.p === p) return offsetFromRun(runs, point.r, point.utf16);
	const probe = document.createRange();
	probe.setStart(node, offset);
	for (const run of paragraph.querySelectorAll('[data-r]')) {
		if (probe.comparePoint(run, 0) >= 0) return offsetFromRun(runs, indexOf(run, 'r'), 0);
	}
	return Array.from(paragraphString(runs)).length;
}

/**
 * selectionSpan maps a DOM range to code points [start,end) of ONE
 * paragraph: the first paragraph of the chapter text that the range
 * covers non-emptily. Ruby text never counts, unlike Range.toString().
 */
export function selectionSpan(
	container: Element,
	range: Range,
	runsOf: RunsOf
): { p: number; start: number; end: number } | null {
	for (const span of coveredSpans(container, range, runsOf)) return span;
	return null;
}

/**
 * highlightSpan is selectionSpan for the highlighter: the same span, and
 * `clamped` when the range also covers a later paragraph (a highlight
 * stays within the paragraph where the selection starts).
 */
export function highlightSpan(
	container: Element,
	range: Range,
	runsOf: RunsOf
): { p: number; start: number; end: number; clamped: boolean } | null {
	const spans = coveredSpans(container, range, runsOf);
	const first = spans.next();
	if (first.done) return null;
	return { ...first.value, clamped: !spans.next().done };
}

function* coveredSpans(
	container: Element,
	range: Range,
	runsOf: RunsOf
): Generator<{ p: number; start: number; end: number }> {
	if (!range.intersectsNode(container)) return;
	for (const paragraph of container.querySelectorAll<HTMLElement>('[data-p]')) {
		if (!range.intersectsNode(paragraph)) continue;
		const p = indexOf(paragraph, 'p');
		const runs = runsOf(p);
		if (!runs) continue;
		const start = paragraph.contains(range.startContainer)
			? boundaryOffset(paragraph, runs, range.startContainer, range.startOffset, 'start')
			: 0;
		const end = paragraph.contains(range.endContainer)
			? boundaryOffset(paragraph, runs, range.endContainer, range.endOffset, 'end')
			: Array.from(paragraphString(runs)).length;
		if (end > start) yield { p, start, end };
	}
}

/**
 * caretUnderPoint is the caret BEFORE the character whose box holds (x, y):
 * caretFromPoint reports the boundary nearest the pointer, which is after
 * the character over its right half. Null when no character is under the
 * point (padding, the space after a line's end).
 */
export function caretUnderPoint(x: number, y: number): { node: Node; offset: number } | null {
	const caret = caretFromPoint(x, y);
	if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
	const text = caret.node as Text;
	const range = document.createRange();
	const isLow = (i: number) => {
		const c = text.data.charCodeAt(i);
		return c >= 0xdc00 && c <= 0xdfff;
	};
	const holds = (start: number) => {
		if (start < 0 || start >= text.length) return false;
		range.setStart(text, start);
		range.setEnd(text, start + (isLow(start + 1) ? 2 : 1));
		return rangeContainsPoint(range, x, y);
	};
	const before = caret.offset - (caret.offset >= 2 && isLow(caret.offset - 1) ? 2 : 1);
	const start = [caret.offset, before].find(holds);
	return start === undefined ? null : { node: text, offset: start };
}

/** rangeForText builds a range over code points [start,end) of an element's text. */
export function rangeForText(element: Element, start: number, end: number): Range {
	const range = document.createRange();
	range.selectNodeContents(element);
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	let cp = 0;
	let startSet = false;
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		const length = utf16ToCodePoint(node.data, node.length);
		if (!startSet && start < cp + length) {
			range.setStart(node, codePointToUtf16(node.data, start - cp));
			startSet = true;
		}
		if (startSet && end <= cp + length) {
			range.setEnd(node, codePointToUtf16(node.data, end - cp));
			break;
		}
		cp += length;
	}
	return range;
}
