// DOM side of the paragraph mapping. ChapterText renders each paragraph as
// <p data-p="i"> and each run as an element with data-r="j" whose FIRST
// text node is the run's displayed text; a shown furigana lives in an <rt>
// after it. Everything here maps DOM boundary points onto that model and
// back; the arithmetic itself lives in paragraphText.ts.
import { locate, offsetFromRun, paragraphString, type Run } from './paragraphText';

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

function baseText(run: Element): Text | null {
	for (const child of run.childNodes) if (child.nodeType === Node.TEXT_NODE) return child as Text;
	return null;
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
	const text = baseText(run);
	const length = text?.length ?? 0;
	const p = indexOf(paragraph, 'p');
	const r = indexOf(run, 'r');
	if (el.closest('rt')) return { p, r, utf16: bias === 'start' ? 0 : length, inRt: true };
	if (node === text) return { p, r, utf16: offset, inRt: false };
	// The run element itself: offset counts children before the point.
	return { p, r, utf16: offset === 0 ? 0 : length, inRt: false };
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
	const textOf = (r: number) => {
		const run = paragraph.querySelector(`[data-r="${r}"]`);
		return run ? baseText(run) : null;
	};
	const startNode = textOf(from.runIndex);
	const endNode = textOf(to.runIndex);
	if (!startNode || !endNode) return null;
	const range = document.createRange();
	range.setStart(startNode, Math.min(from.utf16Offset, startNode.length));
	range.setEnd(endNode, Math.min(to.utf16Offset, endNode.length));
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
	if (!range.intersectsNode(container)) return null;
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
		if (end > start) return { p, start, end };
	}
	return null;
}
