// The hover lookup state machine, DOM-free so it runs under vitest. The
// controller resolves the pointer to a character offset (or to "no word")
// and feeds it here; this decides what to fetch, when to hide, and what to
// show. HIDING and ABORTING are separate:
// - the grace timer only hides the popup currently shown; it never touches
//   a lookup in flight, so a slow lookup for the next word still shows;
// - a pointer on no word (or leaving the text) aborts the lookup in flight
//   (its word was left) and arms the grace hide;
// - the popups are interactive: entering one cancels the grace hide (and
//   aborts a lookup for a word passed on the way) and leaving the last one
//   arms it again, so the pointer can travel from the word into its popup
//   (and into nested popups) without losing them;
// - a lookup that finds nothing shows no popup: it counts as "no word"
//   (a not-found hint is for selections only);
// - close() does both at once (Escape, scroll, re-render, outside click).
import type { LookupResult } from '$lib/api/types';
import { apiErrorMessage } from './errors';
import type { LookupFn } from './lookupCache';
import { sliceCodePoints } from './paragraphText';

export const HOVER_GRACE_MS = 250;

export interface Span {
	p: number;
	start: number;
	end: number;
}

export interface HoverShown {
	/** The paragraph span of the first (longest) result. */
	span: Span;
	/** The matched source text, or the hovered character after an error. */
	text: string;
	/** The hovered code-point offset in the paragraph. */
	offset: number;
	results: LookupResult[];
	error: string;
}

export interface HoverDeps {
	lookup: LookupFn;
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
	/** The last offset whose lookup found nothing, so it is not refetched. */
	#empty: { p: number; offset: number } | null = null;
	/** The pointer is inside a popup of the shown stack. */
	#inPopup = false;

	constructor(deps: HoverDeps) {
		this.#deps = deps;
	}

	/** The pointer rests on character `offset` of paragraph `p` (whose text is `text`). */
	point(p: number, text: string, offset: number): void {
		this.#inPopup = false;
		const shown = this.#shown;
		if (shown && shown.p === p && offset >= shown.start && offset < shown.end) {
			// Back on (or still on) the shown word: keep it, drop any newer lookup.
			this.#cancelHide();
			this.#abort();
			return;
		}
		if (this.#inFlight?.p === p && this.#inFlight.offset === offset) return;
		if (this.#empty?.p === p && this.#empty.offset === offset) return this.noWord();
		this.#hideSoon();
		void this.#lookup(p, text, offset);
	}

	/** The pointer rests on no word (a gap, punctuation, outside the text). */
	noWord(): void {
		this.#abort();
		this.#hideSoon();
	}

	/**
	 * The pointer entered a popup: keep the shown stack, and abort a lookup
	 * for a word passed on the way, whose result would otherwise replace the
	 * stack under the pointer.
	 */
	enterPopup(): void {
		this.#inPopup = true;
		this.#cancelHide();
		this.#abort();
	}

	/** The pointer left a popup (for somewhere that is not another popup). */
	leavePopup(): void {
		this.#inPopup = false;
		this.#hideSoon();
	}

	/** Aborts everything and hides at once. */
	close(): void {
		this.#empty = null;
		this.#inPopup = false;
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
		if (!this.#shown || this.#inPopup || this.#hideTimer !== undefined) return;
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
		let results: LookupResult[] = [];
		let error = '';
		try {
			results = await this.#deps.lookup(this.#deps.lang(), text, offset, undefined, signal);
		} catch (err) {
			error = apiErrorMessage(err, 'lookup');
		}
		// Superseded, aborted, or closed meanwhile: discard.
		if (this.#inFlight !== flight || signal.aborted) return;
		this.#inFlight = null;
		// Never replace the stack under a pointer that is inside it.
		if (this.#inPopup) return;
		if (results.length === 0 && !error) {
			// Nothing here: like a pointer on no word, the shown popup (if
			// any) goes after the grace delay.
			this.#empty = { p, offset };
			this.#hideSoon();
			return;
		}
		this.#empty = null;
		const first = results[0];
		const span = first ? { p, start: first.start, end: first.end } : { p, start: offset, end: offset + 1 };
		this.#cancelHide();
		this.#shown = span;
		this.#deps.show({
			span,
			text: first?.matched ?? sliceCodePoints(text, offset, offset + 1),
			offset,
			results,
			error
		});
	}
}
