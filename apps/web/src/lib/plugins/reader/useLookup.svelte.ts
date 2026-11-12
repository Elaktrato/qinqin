// Hover and selection lookup over the chapter text. One controller per
// reading view; the chapter container delegates its pointer events here
// (no per-paragraph listeners) and attach() wires the document-level ones.
// This file is the DOM side: it turns pointers and selections into
// paragraph offsets. The hover timing (grace, aborts, stale results) lives
// in the DOM-free HoverLookup.
import { segmentAt } from '$lib/api/segment';
import type { SegmentMatch } from '$lib/api/types';
import {
	caretFromPoint,
	rangeContainsPoint,
	rangeForSpan,
	runPointAt,
	selectionSpan,
	type RunsOf
} from './dom';
import { apiErrorMessage } from './errors';
import { HoverLookup, type HoverShown, type Span } from './hoverLookup';
import { hoverable, type LookupKind } from './lookup';
import { offsetFromRun, paragraphString, sliceCodePoints } from './paragraphText';
import { cachedSegment } from './segmentCache';
import { lookupSelection, selectionSpanTarget } from './selectionLookup';

const HOVER_DEBOUNCE_MS = 80;
const SELECTION_DEBOUNCE_MS = 250;
const HIGHLIGHT = 'reader-lookup';

export interface LookupView {
	mode: 'hover' | 'selection';
	/** Where the looked-up text is on screen (viewport coordinates). */
	anchor: DOMRect;
	/** undefined while the tokenizer is still resolving; null when it found nothing. */
	match: SegmentMatch | null | undefined;
	/** The looked-up text, shown when there is no match. */
	text: string;
	kind: LookupKind;
	note: string;
	error: string;
}

export interface LookupOptions {
	container: () => HTMLElement | null;
	lang: () => string;
	runsOf: RunsOf;
}

export class LookupController {
	view = $state<LookupView | null>(null);

	#opts: LookupOptions;
	#segment = cachedSegment(segmentAt);
	#hover: HoverLookup;
	#hoverTimer: ReturnType<typeof setTimeout> | undefined;
	#pointer = { x: 0, y: 0, target: null as EventTarget | null };
	/** Primary button held anywhere in the document: a click or a drag. */
	#pointerDown = false;
	// Selection lookups: their own canceller, sequence and shown span.
	#selectionAbort: AbortController | null = null;
	#selectionSeq = 0;
	#selectionTimer: ReturnType<typeof setTimeout> | undefined;
	#selectionSpan: Span | null = null;
	#frame = 0;

	constructor(opts: LookupOptions) {
		this.#opts = opts;
		this.#hover = new HoverLookup({
			segment: this.#segment,
			lang: opts.lang,
			show: (shown) => this.#showHover(shown),
			hide: () => {
				if (this.view?.mode !== 'hover') return;
				this.#highlight(null);
				this.view = null;
			}
		});
	}

	/** Document-level listeners; returns the cleanup. */
	attach(): () => void {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && this.view) this.close();
		};
		const onDown = (e: PointerEvent) => {
			// Tracked document-wide, so a drag that starts outside the text
			// and extends into it still counts as a drag in progress.
			if (e.button === 0) this.#pointerDown = true;
			if (this.view?.mode !== 'selection') return;
			const target = e.target as Element | null;
			if (!target?.closest?.('[data-lookup-popup]')) this.close();
		};
		const onUp = () => {
			if (!this.#pointerDown) return;
			this.#pointerDown = false;
			this.#scheduleSelection(30);
		};
		const onSelection = () => {
			if (!this.#pointerDown) this.#scheduleSelection(SELECTION_DEBOUNCE_MS);
		};
		const onScroll = () => {
			if (this.view?.mode === 'hover') this.close();
			else if (this.view && !this.#frame) this.#frame = requestAnimationFrame(() => this.#reanchor());
		};
		window.addEventListener('keydown', onKey);
		window.addEventListener('pointerdown', onDown, true);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		window.addEventListener('scroll', onScroll, { capture: true, passive: true });
		document.addEventListener('selectionchange', onSelection);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			window.removeEventListener('scroll', onScroll, { capture: true });
			document.removeEventListener('selectionchange', onSelection);
			this.close();
		};
	}

	// --- container events (delegated) ---

	pointermove = (e: PointerEvent): void => {
		// Hover is a mouse enhancement; touch and pen select instead.
		if (e.pointerType !== 'mouse') return;
		if (this.#pointerDown && e.buttons === 0) {
			// The button was released outside the window: the drag is over.
			this.#pointerDown = false;
			this.#scheduleSelection(30);
		}
		if (this.#pointerDown || e.buttons !== 0) return;
		if (this.view?.mode === 'selection') return;
		this.#pointer = { x: e.clientX, y: e.clientY, target: e.target };
		clearTimeout(this.#hoverTimer);
		this.#hoverTimer = setTimeout(() => this.#resolveHover(), HOVER_DEBOUNCE_MS);
	};

	pointerleave = (e: PointerEvent): void => {
		if (e.pointerType !== 'mouse') return;
		clearTimeout(this.#hoverTimer);
		this.#hover.close();
	};

	pointerdown = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		clearTimeout(this.#hoverTimer);
		this.#hover.close();
	};

	/** Closes the popup and cancels everything in flight. */
	close(): void {
		clearTimeout(this.#hoverTimer);
		this.#hover.close();
		this.#selectionSeq++;
		this.#selectionAbort?.abort();
		this.#selectionAbort = null;
		this.#selectionSpan = null;
		clearTimeout(this.#selectionTimer);
		cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		this.#highlight(null);
		this.view = null;
	}

	// --- hover ---

	#resolveHover(): void {
		const container = this.#opts.container();
		const { x, y, target } = this.#pointer;
		// Only text counts: the gaps between lines and paragraphs do not.
		if (!container || !(target instanceof Element) || !target.closest('[data-r]')) {
			return this.#hover.noWord();
		}
		const caret = caretFromPoint(x, y);
		const point = caret && runPointAt(caret.node, caret.offset, 'start');
		const runs = point && this.#opts.runsOf(point.p);
		if (!point || !runs) return this.#hover.noWord();
		const text = paragraphString(runs);
		let offset = offsetFromRun(runs, point.r, point.utf16);
		if (!point.inRt) {
			// The caret is the boundary NEAREST the pointer: over the right
			// half of a character it is after it. Use the character whose box
			// actually holds the pointer.
			const under = [offset, offset - 1].find((o) => {
				const range = o >= 0 && rangeForSpan(container, point.p, runs, o, o + 1);
				return range && rangeContainsPoint(range, x, y);
			});
			if (under === undefined) return this.#hover.noWord();
			offset = under;
		}
		if (!hoverable(sliceCodePoints(text, offset, offset + 1))) return this.#hover.noWord();
		this.#hover.point(point.p, text, offset);
	}

	#showHover(shown: HoverShown): void {
		// A sticky selection popup is never replaced by a hover result.
		if (this.view?.mode === 'selection') return;
		const range = this.#rangeOf(shown.span);
		if (!range) return this.#hover.close();
		this.#highlight(range);
		this.view = {
			mode: 'hover',
			anchor: range.getBoundingClientRect(),
			match: shown.match,
			text: shown.text,
			kind: 'word',
			note: '',
			error: shown.error
		};
	}

	// --- selection ---

	#scheduleSelection(delay: number): void {
		clearTimeout(this.#selectionTimer);
		this.#selectionTimer = setTimeout(() => void this.#resolveSelection(), delay);
	}

	async #resolveSelection(): Promise<void> {
		const container = this.#opts.container();
		const selection = typeof window === 'undefined' ? null : window.getSelection();
		if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
		const found = selectionSpan(container, selection.getRangeAt(0), this.#opts.runsOf);
		const runs = found && this.#opts.runsOf(found.p);
		if (!found || !runs) return;
		const text = paragraphString(runs);
		const target = selectionSpanTarget(text, found.start, found.end);
		if (!target) return;
		const span = { p: found.p, start: target.start, end: target.end };
		const shown = this.#selectionSpan;
		if (
			this.view?.mode === 'selection' &&
			shown &&
			shown.p === span.p &&
			shown.start === span.start &&
			shown.end === span.end
		) {
			return;
		}
		const range = this.#rangeOf(span);
		if (!range) return;
		clearTimeout(this.#hoverTimer);
		this.#hover.close();
		this.#selectionAbort?.abort();
		const abort = new AbortController();
		this.#selectionAbort = abort;
		const seq = ++this.#selectionSeq;
		this.#selectionSpan = span;
		this.#highlight(null);
		this.view = {
			mode: 'selection',
			anchor: range.getBoundingClientRect(),
			match: undefined,
			text: target.text,
			kind: target.kind,
			note: '',
			error: ''
		};
		const lang = this.#opts.lang();
		try {
			const result = await lookupSelection(lang, text, target, this.#segment, abort.signal);
			if (seq !== this.#selectionSeq || !this.view) return;
			this.view = { ...this.view, match: result.match, note: result.note };
		} catch (err) {
			if (abort.signal.aborted || seq !== this.#selectionSeq || !this.view) return;
			this.view = { ...this.view, match: null, error: apiErrorMessage(err, 'lookup') };
		}
	}

	// --- shared ---

	#rangeOf(span: Span): Range | null {
		const container = this.#opts.container();
		const runs = this.#opts.runsOf(span.p);
		return container && runs ? rangeForSpan(container, span.p, runs, span.start, span.end) : null;
	}

	#reanchor(): void {
		this.#frame = 0;
		const range = this.#selectionSpan && this.#rangeOf(this.#selectionSpan);
		if (range && this.view) this.view = { ...this.view, anchor: range.getBoundingClientRect() };
	}

	// Marks the hovered word without touching the DOM, where supported.
	#highlight(range: Range | null): void {
		if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
		if (range) CSS.highlights.set(HIGHLIGHT, new Highlight(range));
		else CSS.highlights.delete(HIGHLIGHT);
	}
}
