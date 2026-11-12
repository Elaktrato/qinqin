// The hover lookup state machine, DOM-free so it runs under vitest. The
// controller resolves the pointer to a character offset (or to "no word")
// and feeds it here; this decides what to fetch, when to hide, and what to
// show. HIDING and ABORTING are separate:
// - the grace timer only hides the popup currently shown; it never touches
//   a lookup in flight, so a slow lookup for the next word still shows;
// - a pointer on no word aborts the lookup in flight (its word was left)
//   and arms the grace hide;
// - close() does both at once (Escape, scroll, leaving the text, re-render).
import type { SegmentMatch } from '$lib/api/types';
import { apiErrorMessage } from './errors';
import { sliceCodePoints } from './paragraphText';
import type { SegmentFn } from './selectionLookup';

export const HOVER_GRACE_MS = 250;

export interface Span {
	p: number;
	start: number;
	end: number;
}

export interface HoverShown {
	span: Span;
	match: SegmentMatch | null;
	text: string;
	error: string;
}

export interface HoverDeps {
	segment: SegmentFn;
	lang: () => string;
	show: (shown: HoverShown) => void;
	hide: () => void;
}

export class HoverLookup {
	#deps: HoverDeps;
	/** The lookup in flight: its offset and its canceller. */
	#inFlight: { p: number; offset: number; abort: AbortController } | null = null;
	#hideTimer: ReturnType<typeof setTimeout> | undefined;
	/** The span of the popup currently shown, if any. */
	#shown: Span | null = null;

	constructor(deps: HoverDeps) {
		this.#deps = deps;
	}

	/** The pointer rests on character `offset` of paragraph `p` (whose text is `text`). */
	point(p: number, text: string, offset: number): void {
		const shown = this.#shown;
		if (shown && shown.p === p && offset >= shown.start && offset < shown.end) {
			// Back on (or still on) the shown word: keep it, drop any newer lookup.
			this.#cancelHide();
			this.#abort();
			return;
		}
		if (this.#inFlight?.p === p && this.#inFlight.offset === offset) return;
		this.#hideSoon();
		void this.#lookup(p, text, offset);
	}

	/** The pointer rests on no word (a gap, punctuation, outside the runs). */
	noWord(): void {
		this.#abort();
		this.#hideSoon();
	}

	/** Aborts everything and hides at once. */
	close(): void {
		this.#abort();
		this.#cancelHide();
		this.#hide();
	}

	#abort(): void {
		this.#inFlight?.abort.abort();
		this.#inFlight = null;
	}

	#hide(): void {
		if (!this.#shown) return;
		this.#shown = null;
		this.#deps.hide();
	}

	#hideSoon(): void {
		if (!this.#shown || this.#hideTimer !== undefined) return;
		this.#hideTimer = setTimeout(() => {
			this.#hideTimer = undefined;
			this.#hide();
		}, HOVER_GRACE_MS);
	}

	#cancelHide(): void {
		clearTimeout(this.#hideTimer);
		this.#hideTimer = undefined;
	}

	async #lookup(p: number, text: string, offset: number): Promise<void> {
		this.#abort();
		const flight = { p, offset, abort: new AbortController() };
		this.#inFlight = flight;
		const { signal } = flight.abort;
		let match: SegmentMatch | null = null;
		let error = '';
		try {
			match = await this.#deps.segment(this.#deps.lang(), text, offset, signal);
		} catch (err) {
			error = apiErrorMessage(err, 'lookup');
		}
		// Superseded, aborted, or closed meanwhile: discard.
		if (this.#inFlight !== flight || signal.aborted) return;
		this.#inFlight = null;
		const span = match
			? { p, start: match.start, end: match.end }
			: { p, start: offset, end: offset + 1 };
		this.#cancelHide();
		this.#shown = span;
		this.#deps.show({
			span,
			match,
			text: match?.surface ?? sliceCodePoints(text, offset, offset + 1),
			error
		});
	}
}
