// Hover and selection lookup over the chapter text. One controller per
// reading view; the chapter container delegates its pointer events here
// (no per-paragraph listeners) and attach() wires the document-level ones.
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
import { selectionTarget, type LookupKind } from './lookup';
import { offsetFromRun, paragraphString, sliceCodePoints } from './paragraphText';
import { cachedSegment } from './segmentCache';
import { lookupSelection, selectionSpanTarget } from './selectionLookup';

const HOVER_DEBOUNCE_MS = 80;
const HOVER_GRACE_MS = 250;
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

interface Span {
	p: number;
	start: number;
	end: number;
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
	#seq = 0;
	#abort: AbortController | null = null;
	#hoverTimer: ReturnType<typeof setTimeout> | undefined;
	#closeTimer: ReturnType<typeof setTimeout> | undefined;
	#selectionTimer: ReturnType<typeof setTimeout> | undefined;
	#pointer = { x: 0, y: 0, target: null as EventTarget | null };
	#pointerDown = false;
	/** The span the current popup is about; hovering inside it does nothing. */
	#span: Span | null = null;
	/** The hover lookup in flight, so repeated moves over it do not refetch. */
	#pending: { p: number; offset: number } | null = null;
	#frame = 0;

	constructor(opts: LookupOptions) {
		this.#opts = opts;
	}

	/** Document-level listeners; returns the cleanup. */
	attach(): () => void {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && this.view) this.close();
		};
		const onDown = (e: PointerEvent) => {
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
		if (e.pointerType !== 'mouse' || this.#pointerDown || e.buttons !== 0) return;
		if (this.view?.mode === 'selection') return;
		this.#pointer = { x: e.clientX, y: e.clientY, target: e.target };
		clearTimeout(this.#hoverTimer);
		this.#hoverTimer = setTimeout(() => this.#resolveHover(), HOVER_DEBOUNCE_MS);
	};

	pointerleave = (e: PointerEvent): void => {
		if (e.pointerType !== 'mouse') return;
		clearTimeout(this.#hoverTimer);
		if (this.view?.mode !== 'selection') this.close();
	};

	pointerdown = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		this.#pointerDown = true;
		clearTimeout(this.#hoverTimer);
		if (this.view?.mode === 'hover') this.close();
	};

	/** Closes the popup and cancels everything in flight. */
	close(): void {
		this.#seq++;
		this.#abort?.abort();
		this.#abort = null;
		this.#pending = null;
		this.#span = null;
		clearTimeout(this.#hoverTimer);
		this.#cancelClose();
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
			return this.#closeSoon();
		}
		const caret = caretFromPoint(x, y);
		const point = caret && runPointAt(caret.node, caret.offset, 'start');
		const runs = point && this.#opts.runsOf(point.p);
		if (!point || !runs) return this.#closeSoon();
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
			if (under === undefined) return this.#closeSoon();
			offset = under;
		}
		const span = this.#span;
		if (span && span.p === point.p && offset >= span.start && offset < span.end) {
			return this.#cancelClose();
		}
		if (this.#pending?.p === point.p && this.#pending.offset === offset) return;
		const char = sliceCodePoints(text, offset, offset + 1);
		if (!selectionTarget(char)) return this.#closeSoon();
		this.#closeSoon();
		void this.#lookupHover(point.p, text, offset);
	}

	async #lookupHover(p: number, text: string, offset: number): Promise<void> {
		const { seq, signal } = this.#begin();
		this.#pending = { p, offset };
		const lang = this.#opts.lang();
		let match: SegmentMatch | null = null;
		let error = '';
		try {
			match = await this.#segment(lang, text, offset, signal);
		} catch (err) {
			if (signal.aborted) return;
			error = apiErrorMessage(err, 'lookup');
		}
		if (seq !== this.#seq) return;
		this.#pending = null;
		const span = match
			? { p, start: match.start, end: match.end }
			: { p, start: offset, end: offset + 1 };
		this.#show('hover', span, {
			match,
			text: match?.surface ?? sliceCodePoints(text, offset, offset + 1),
			kind: 'word',
			note: '',
			error
		});
	}

	#closeSoon(): void {
		if (this.view?.mode !== 'hover' || this.#closeTimer !== undefined) return;
		this.#closeTimer = setTimeout(() => this.close(), HOVER_GRACE_MS);
	}

	#cancelClose(): void {
		clearTimeout(this.#closeTimer);
		this.#closeTimer = undefined;
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
		const shown = this.#span;
		if (
			this.view?.mode === 'selection' &&
			shown &&
			shown.p === span.p &&
			shown.start === span.start &&
			shown.end === span.end
		) {
			return;
		}
		const { seq, signal } = this.#begin();
		this.#show('selection', span, { match: undefined, text: target.text, kind: target.kind, note: '', error: '' });
		const lang = this.#opts.lang();
		try {
			const result = await lookupSelection(lang, text, target, this.#segment, signal);
			if (seq !== this.#seq || !this.view) return;
			this.view = { ...this.view, match: result.match, note: result.note };
		} catch (err) {
			if (signal.aborted || seq !== this.#seq || !this.view) return;
			this.view = { ...this.view, match: null, error: apiErrorMessage(err, 'lookup') };
		}
	}

	// --- shared ---

	/** Starts a lookup: cancels the previous one (hover or selection). */
	#begin(): { seq: number; signal: AbortSignal } {
		this.#abort?.abort();
		this.#abort = new AbortController();
		return { seq: ++this.#seq, signal: this.#abort.signal };
	}

	#show(mode: LookupView['mode'], span: Span, rest: Omit<LookupView, 'mode' | 'anchor'>): void {
		const container = this.#opts.container();
		const runs = this.#opts.runsOf(span.p);
		const range = container && runs && rangeForSpan(container, span.p, runs, span.start, span.end);
		if (!range) return this.close();
		this.#cancelClose();
		this.#span = span;
		this.#highlight(mode === 'hover' ? range : null);
		this.view = { mode, anchor: range.getBoundingClientRect(), ...rest };
	}

	#reanchor(): void {
		this.#frame = 0;
		const span = this.#span;
		const container = this.#opts.container();
		const runs = span && this.#opts.runsOf(span.p);
		const range = container && span && runs && rangeForSpan(container, span.p, runs, span.start, span.end);
		if (range && this.view) this.view = { ...this.view, anchor: range.getBoundingClientRect() };
	}

	// Marks the hovered word without touching the DOM, where supported.
	#highlight(range: Range | null): void {
		if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
		if (range) CSS.highlights.set(HIGHLIGHT, new Highlight(range));
		else CSS.highlights.delete(HIGHLIGHT);
	}
}
