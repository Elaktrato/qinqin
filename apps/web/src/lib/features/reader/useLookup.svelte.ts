// Hover, tap and selection lookup over the chapter text, shown as a stack of
// popups. One controller per reading view; listen() delegates the text
// container's pointer events here (no per-paragraph listeners), the popups
// delegate theirs to `popups` (PopupPointer), and attach() wires the
// document-level ones. This file is the DOM side: it turns pointers, taps
// and selections into text offsets. The timing (grace, aborts, stale
// results) lives in the DOM-free HoverLookup and NestedScan, what a tap is
// in tapGesture, and where the word scrolls to in keepAbove.
import { lookupAt } from '$lib/api/lookup';
import type { LookupResult } from '$lib/api/types';
import { DwellCounter } from '$lib/lookups/dwell';
import {
	caretFromPoint,
	highlightSpan,
	paragraphElement,
	rangeContainsPoint,
	rangeForSpan,
	runPointAt,
	selectionSpan,
	type RunsOf
} from './dom';
import { apiErrorMessage } from './errors';
import type { ParagraphSpan } from './highlightUi';
import { HoverLookup, type HoverShown, type Span } from './hoverLookup';
import { scrollDeltaAbove, scrollParent } from './keepAbove';
import { hoverable } from './lookup';
import { cachedLookup } from './lookupCache';
import { offsetFromRun, paragraphString, sliceCodePoints } from './paragraphText';
import { anchorOf, inPopup, PopupPointer } from './popupPointer.svelte';
import { PopupStack } from './popupStack.svelte';
import { lookupSelection, selectionSpanTarget } from './selectionLookup';
import { TAP_IGNORE, TAP_SETTLE_MS, TapTracker, tapProbes, touchClick, type PointerSample } from './tapGesture';

const HOVER_DEBOUNCE_MS = 80;
const SELECTION_DEBOUNCE_MS = 250;
const HIGHLIGHT = 'reader-lookup';

/** What the whole open stack shares: how it was opened and its language. */
export interface StackInfo {
	/** Hover stacks close after the grace delay; selection stacks (a selection or a tap) are sticky. */
	mode: 'hover' | 'selection';
	/** The lookup language (zh, ja): what data-scan regions look up in. */
	lang: string;
	/** The lang attribute of CJK text, as the reader text uses (zh-Hans/zh-Hant). */
	textLang: string;
	/** Shown in the root popup (selection fallbacks). */
	note: string;
	/**
	 * The text of the paragraph the root popup was opened on: result
	 * offsets of the root popup are code points in it (the book sentence
	 * saved with a study card is cut from it).
	 */
	paragraph: string;
}

export interface LookupOptions {
	container: () => HTMLElement | null;
	lang: () => string;
	/** The reader text's lang attribute (zh-Hans/zh-Hant select glyphs). */
	textLang: () => string;
	runsOf: RunsOf;
	/**
	 * A lookup for the lookup history (#72): a root hover popup that stayed
	 * open HOVER_DWELL_MS or was entered, or a selection or tap popup with
	 * results (both 'selection'); the entry is the popup's first result.
	 * Nested popups never count.
	 */
	onLookup?: (entryId: number, mode: 'hover' | 'selection') => void;
	/** The clock taps are timed with (ms); performance.now by default. */
	now?: () => number;
	/**
	 * A tap inside the text found no word (punctuation, Latin, digits, a
	 * gap): what it landed on, so the reader can open a highlight there.
	 */
	onTapNoWord?: (target: Element) => void;
}

/** A word under a point: paragraph p, its text, and the code point there. */
interface WordPoint {
	p: number;
	text: string;
	offset: number;
}

function reducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class LookupController {
	readonly stack = new PopupStack();
	info = $state<StackInfo | null>(null);
	readonly popups: PopupPointer;

	#opts: LookupOptions;
	#lookup = cachedLookup(lookupAt);
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
	#dwell: DwellCounter;
	/** The paragraph of the current (or last) lookup's word, for focus after the phone sheet closes. */
	#word: HTMLElement | null = null;
	// Taps (touch and pen): the gesture, the settle timer, the last touch release.
	#tap = new TapTracker();
	#tapTimer: ReturnType<typeof setTimeout> | undefined;
	#lastTouchUp: number | null = null;
	#now: () => number;
	/** The open sticky stack was opened by a tap (not a selection). */
	tapped = false;
	/**
	 * The selection a selection popup was opened for, as the highlighter
	 * needs it (untrimmed, clamped to its first paragraph); null otherwise.
	 */
	selectedSpan: ParagraphSpan | null = null;

	constructor(opts: LookupOptions) {
		this.#opts = opts;
		this.#now = opts.now ?? (() => performance.now());
		this.#dwell = new DwellCounter((entryId) => this.#opts.onLookup?.(entryId, 'hover'));
		this.#hover = new HoverLookup({
			lookup: this.#lookup,
			lang: opts.lang,
			show: (shown) => this.#showHover(shown),
			hide: () => {
				if (this.info?.mode === 'hover') this.close();
			}
		});
		this.popups = new PopupPointer({
			lookup: this.#lookup,
			stack: this.stack,
			// A hover lookup still debouncing is for a word passed on the way.
			entered: () => {
				clearTimeout(this.#hoverTimer);
				this.#hover.enterPopup();
				if (this.info?.mode === 'hover') this.#dwell.entered();
			},
			left: () => this.#hover.leavePopup()
		});
	}

	/** Document-level listeners; returns the cleanup. */
	attach(): () => void {
		const onKey = (e: KeyboardEvent) => {
			// Escape that cancels an IME composition (or was handled) is not ours.
			if (e.key === 'Escape' && this.info && !e.isComposing && !e.defaultPrevented) this.closeTop();
			this.popups.key(e);
		};
		const onDown = (e: PointerEvent) => {
			// Tracked document-wide, so a drag that starts outside the text
			// and extends into it still counts as a drag in progress.
			if (e.button === 0) this.#pointerDown = true;
			clearTimeout(this.#tapTimer);
			this.#tap.down(this.#sample(e));
			// A tap on no word closes the lookup here; a tap on a word opens the next.
			if (this.info && !inPopup(e.target)) this.close();
		};
		const onMove = (e: PointerEvent) => this.#tap.move(this.#sample(e));
		const release = () => {
			if (!this.#pointerDown) return;
			this.#pointerDown = false;
			this.#scheduleSelection(30);
		};
		const onUp = (e: PointerEvent) => {
			const sample = this.#sample(e);
			if (sample.type === 'touch' || sample.type === 'pen') this.#lastTouchUp = sample.at;
			const point = this.#tap.up(sample);
			if (point) {
				const target = e.target;
				clearTimeout(this.#tapTimer);
				this.#tapTimer = setTimeout(() => void this.#resolveTap(point.x, point.y, target), TAP_SETTLE_MS);
			}
			release();
		};
		const onCancel = () => {
			// The browser took the gesture over (a pan, a zoom): no tap.
			this.#tap.cancel();
			release();
		};
		const onSelection = () => {
			if (!this.#pointerDown) this.#scheduleSelection(SELECTION_DEBOUNCE_MS);
		};
		const onScroll = (e: Event) => {
			// A finger that scrolled the page did not tap, nor does one that stops a fling.
			this.#tap.scrolled(this.#now());
			// A popup scrolling its own long entry list moves nothing.
			if (!this.info || inPopup(e.target)) return;
			if (this.info.mode === 'hover') this.close();
			else if (!this.#frame) this.#frame = requestAnimationFrame(() => this.#reanchor());
		};
		window.addEventListener('keydown', onKey);
		window.addEventListener('keyup', this.popups.key);
		window.addEventListener('blur', this.popups.blur);
		window.addEventListener('pointerdown', onDown, true);
		window.addEventListener('pointermove', onMove, { passive: true });
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		window.addEventListener('scroll', onScroll, { capture: true, passive: true });
		document.addEventListener('selectionchange', onSelection);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('keyup', this.popups.key);
			window.removeEventListener('blur', this.popups.blur);
			window.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			window.removeEventListener('scroll', onScroll, { capture: true });
			document.removeEventListener('selectionchange', onSelection);
			this.close();
		};
	}

	/**
	 * listen wires the text container's pointer events to this controller
	 * (hover) and sets touch-action: manipulation on it, so a tap is not held
	 * back for a double-tap zoom; returns the cleanup, which gives the
	 * element's touch-action back.
	 */
	listen(el: HTMLElement): () => void {
		const options = { passive: true };
		el.addEventListener('pointermove', this.pointermove, options);
		el.addEventListener('pointerleave', this.pointerleave, options);
		el.addEventListener('pointerdown', this.pointerdown, options);
		const touchAction = el.style.touchAction;
		el.style.touchAction = 'manipulation';
		return () => {
			el.removeEventListener('pointermove', this.pointermove);
			el.removeEventListener('pointerleave', this.pointerleave);
			el.removeEventListener('pointerdown', this.pointerdown);
			el.style.touchAction = touchAction;
		};
	}

	/**
	 * fromTouch tells a click that a touch or pen tap produced (the tap has
	 * opened its lookup already), so a click handler on the text can leave it
	 * alone; a mouse click is never one.
	 */
	fromTouch(e: MouseEvent): boolean {
		return touchClick(
			{ pointerType: (e as Partial<PointerEvent>).pointerType, detail: e.detail, at: this.#now() },
			this.#lastTouchUp
		);
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
		if (this.info?.mode === 'selection') return;
		this.#pointer = { x: e.clientX, y: e.clientY, target: e.target };
		clearTimeout(this.#hoverTimer);
		this.#hoverTimer = setTimeout(() => this.#resolveHover(), HOVER_DEBOUNCE_MS);
	};

	pointerleave = (e: PointerEvent): void => {
		if (e.pointerType !== 'mouse') return;
		clearTimeout(this.#hoverTimer);
		// Possibly on the way into the popup: the grace delay decides.
		this.#hover.noWord();
	};

	pointerdown = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		clearTimeout(this.#hoverTimer);
		this.#hover.close();
	};

	// --- closing ---

	/** Closes every popup and cancels everything in flight. */
	close(): void {
		clearTimeout(this.#hoverTimer);
		clearTimeout(this.#tapTimer);
		this.#hover.close();
		this.#dwell.closed();
		this.popups.cancel();
		this.#selectionSeq++;
		this.#selectionAbort?.abort();
		this.#selectionAbort = null;
		this.#selectionSpan = null;
		this.selectedSpan = null;
		clearTimeout(this.#selectionTimer);
		cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		this.#highlight(null);
		this.stack.closeAll();
		this.info = null;
		this.tapped = false;
	}

	/**
	 * hold pins a hover stack while a menu inside a popup is open (no grace
	 * hide, no replacement by another word); release with hold(false).
	 */
	hold(on: boolean): void {
		this.#hover.hold(on);
	}

	/** Escape: the top popup only; the last one closes everything. */
	closeTop(): void {
		if (this.stack.frames.length <= 1) return this.close();
		this.stack.closeTop();
		this.popups.prune();
	}

	/**
	 * The phone sheet shows the root frame only (a mouse cannot nest there):
	 * drop every frame opened from it, so narrowing a window leaves nothing
	 * outside the now modal sheet.
	 */
	closeNested(): void {
		const root = this.stack.frames[0];
		if (!root) return;
		this.stack.closeAbove(root.id);
		this.popups.prune();
	}

	/** A popup's close button: that popup and the ones opened from it. */
	closeFrame(id: number): void {
		const index = this.stack.frames.findIndex((f) => f.id === id);
		if (index < 0) return;
		if (index === 0) return this.close();
		this.stack.closeAbove(this.stack.frames[index - 1].id);
		this.popups.prune();
	}

	// --- hover ---

	#resolveHover(): void {
		const { x, y, target } = this.#pointer;
		const at = this.#wordAt(x, y, target);
		if (!at) return this.#hover.noWord();
		this.#hover.point(at.p, at.text, at.offset);
	}

	/**
	 * wordAt finds the lookable character under a point of the text: the
	 * word finding of hover and tap alike, so the two always agree. Null
	 * over a gap between lines or paragraphs, outside the text, or on
	 * whitespace, punctuation, Latin letters and digits. A tap (`tap`) may
	 * land in the gap between lines: it also tries points up to TAP_SLACK_PX
	 * above and below (tapProbes) and takes the first character it meets;
	 * hover stays exact.
	 */
	#wordAt(x: number, y: number, target: EventTarget | null, tap = false): WordPoint | null {
		const container = this.#opts.container();
		// Only text counts: for hover the gaps between lines and paragraphs do not.
		if (!container || !(target instanceof Element) || !container.contains(target)) return null;
		if (!target.closest(tap ? '[data-p]' : '[data-r]')) return null;
		for (const probe of tap ? tapProbes(x, y) : [{ x, y }]) {
			const at = this.#charAt(container, probe.x, probe.y);
			if (at) return hoverable(sliceCodePoints(at.text, at.offset, at.offset + 1)) ? at : null;
		}
		return null;
	}

	/** The character whose box holds the point, whatever it is; null over no character. */
	#charAt(container: HTMLElement, x: number, y: number): WordPoint | null {
		const caret = caretFromPoint(x, y);
		const point = caret && runPointAt(caret.node, caret.offset, 'start');
		const runs = point && this.#opts.runsOf(point.p);
		if (!point || !runs) return null;
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
			if (under === undefined) return null;
			offset = under;
		}
		return { p: point.p, text, offset };
	}

	#sample(e: PointerEvent): PointerSample {
		return {
			id: e.pointerId,
			type: e.pointerType,
			x: e.clientX,
			y: e.clientY,
			at: this.#now(),
			primary: e.isPrimary,
			button: e.button
		};
	}

	// --- tap ---

	/**
	 * A tap (touch or pen) at x, y: the word under it opens a sticky lookup
	 * the way a selection does, on the span of its first (longest) result.
	 * A tap on a control, or one that left a selection (a long press), is
	 * not ours; a tap on no word leaves the lookup closed (pointerdown
	 * closed it).
	 */
	async #resolveTap(x: number, y: number, target: EventTarget | null): Promise<void> {
		const container = this.#opts.container();
		if (!container || !(target instanceof Element) || !container.contains(target) || target.closest(TAP_IGNORE)) return;
		const selection = typeof window === 'undefined' ? null : window.getSelection();
		if (selection && selection.rangeCount > 0 && !selection.isCollapsed) return;
		const at = this.#wordAt(x, y, target, true);
		this.close();
		if (!at) return this.#opts.onTapNoWord?.(target);
		const abort = new AbortController();
		this.#selectionAbort = abort;
		const seq = this.#selectionSeq;
		const lang = this.#opts.lang();
		let results: LookupResult[] = [];
		let error = '';
		try {
			results = await this.#lookup(lang, at.text, at.offset, undefined, abort.signal);
		} catch (err) {
			error = apiErrorMessage(err, 'lookup');
		}
		if (abort.signal.aborted || seq !== this.#selectionSeq) return;
		const first = results[0];
		const span = first ? { p: at.p, start: first.start, end: first.end } : { p: at.p, start: at.offset, end: at.offset + 1 };
		const range = this.#rangeOf(span);
		if (!range) return;
		this.#highlight(range);
		this.#word = paragraphElement(container, span.p);
		this.#selectionSpan = span;
		this.selectedSpan = { ...span, clamped: false };
		const id = this.stack.open({
			anchor: anchorOf(range.getBoundingClientRect()),
			text: first?.matched ?? sliceCodePoints(at.text, at.offset, at.offset + 1),
			offset: at.offset,
			results,
			error: error || undefined
		});
		if (id === null) return;
		this.tapped = true;
		this.info = { mode: 'selection', lang, textLang: this.#opts.textLang(), note: '', paragraph: at.text };
		if (first) this.#opts.onLookup?.(first.entryId, 'selection');
	}

	/**
	 * keepWordAbove scrolls the text so the word of the sticky lookup ends
	 * above `sheetTop` (the phone sheet's top edge, viewport px) with a small
	 * margin. The phone sheet calls it when it opens and when it grows; a
	 * word in view already does not move. Never for a hover lookup, which a
	 * scroll closes.
	 */
	keepWordAbove(sheetTop: number): void {
		if (this.info?.mode !== 'selection' || !this.#selectionSpan) return;
		const range = this.#rangeOf(this.#selectionSpan);
		if (!range) return;
		const scroller = this.#word?.isConnected ? scrollParent(this.#word) : null;
		const top = scroller ? scroller.getBoundingClientRect().top : 0;
		const delta = scrollDeltaAbove(range.getBoundingClientRect(), { top, bottom: sheetTop });
		if (Math.abs(delta) < 1) return;
		(scroller ?? window).scrollBy({ top: delta, behavior: reducedMotion() ? 'instant' : 'smooth' });
	}

	#showHover(shown: HoverShown): void {
		// A sticky selection stack is never replaced by a hover result.
		if (this.info?.mode === 'selection') return;
		const range = this.#rangeOf(shown.span);
		if (!range) return this.#hover.close();
		this.#highlight(range);
		const container = this.#opts.container();
		this.#word = container ? paragraphElement(container, shown.span.p) : null;
		this.popups.cancel();
		this.stack.open({
			anchor: anchorOf(range.getBoundingClientRect()),
			text: shown.text,
			offset: shown.offset,
			results: shown.results,
			error: shown.error || undefined
		});
		const runs = this.#opts.runsOf(shown.span.p);
		this.info = {
			mode: 'hover',
			lang: this.#opts.lang(),
			textLang: this.#opts.textLang(),
			note: '',
			paragraph: runs ? paragraphString(runs) : ''
		};
		this.#dwell.shown(shown.results[0]?.entryId ?? null);
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
		const forHighlight = highlightSpan(container, selection.getRangeAt(0), this.#opts.runsOf);
		const shown = this.#selectionSpan;
		if (
			this.info?.mode === 'selection' &&
			shown &&
			shown.p === span.p &&
			shown.start === span.start &&
			shown.end === span.end
		) {
			// Same lookup; the selection may have grown past the paragraph.
			this.selectedSpan = forHighlight;
			return;
		}
		const range = this.#rangeOf(span);
		if (!range) return;
		this.close();
		this.#word = paragraphElement(container, span.p);
		const abort = new AbortController();
		this.#selectionAbort = abort;
		const seq = this.#selectionSeq;
		this.#selectionSpan = span;
		this.selectedSpan = forHighlight;
		const lang = this.#opts.lang();
		const id = this.stack.open({
			anchor: anchorOf(range.getBoundingClientRect()),
			text: target.text,
			offset: target.start,
			results: null
		});
		if (id === null) return;
		this.info = { mode: 'selection', lang, textLang: this.#opts.textLang(), note: '', paragraph: text };
		try {
			const found = await lookupSelection(lang, text, target, this.#lookup, abort.signal);
			if (seq !== this.#selectionSeq || !this.info) return;
			this.stack.update(id, { results: found.results });
			this.info = { ...this.info, note: found.note };
			const first = found.results[0];
			if (first) this.#opts.onLookup?.(first.entryId, 'selection');
		} catch (err) {
			if (abort.signal.aborted || seq !== this.#selectionSeq) return;
			this.stack.update(id, { results: [], error: apiErrorMessage(err, 'lookup') });
		}
	}

	/**
	 * wordParagraph is the <p> the current (or last) lookup was opened on:
	 * the phone sheet returns focus there, because the page text itself is
	 * not a tab stop. Null once the chapter was re-rendered under it.
	 */
	wordParagraph(): HTMLElement | null {
		return this.#word?.isConnected ? this.#word : null;
	}

	/**
	 * currentSelection maps the page's selection right now (for the `h`
	 * key) to the highlighter's span; null when nothing in the chapter text
	 * is selected.
	 */
	currentSelection(): ParagraphSpan | null {
		const container = this.#opts.container();
		const selection = typeof window === 'undefined' ? null : window.getSelection();
		if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
		return highlightSpan(container, selection.getRangeAt(0), this.#opts.runsOf);
	}

	// --- shared ---

	#rangeOf(span: Span): Range | null {
		const container = this.#opts.container();
		const runs = this.#opts.runsOf(span.p);
		return container && runs ? rangeForSpan(container, span.p, runs, span.start, span.end) : null;
	}

	// The page scrolled under a sticky selection stack: the root follows its
	// text; popups opened from it would no longer sit on their words.
	#reanchor(): void {
		this.#frame = 0;
		const root = this.stack.frames[0];
		const range = this.#selectionSpan && this.#rangeOf(this.#selectionSpan);
		if (!root || !range) return;
		this.stack.closeAbove(root.id);
		this.popups.prune();
		this.stack.update(root.id, { anchor: anchorOf(range.getBoundingClientRect()) });
	}

	// Marks the looked-up word without touching the DOM, where supported.
	#highlight(range: Range | null): void {
		if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
		if (range) CSS.highlights.set(HIGHLIGHT, new Highlight(range));
		else CSS.highlights.delete(HIGHLIGHT);
	}
}
