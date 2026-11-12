// Popup-on-a-popup lookups, DOM-free so they run under vitest. While Shift
// is held, the DOM side resolves the pointer inside a popup to a data-scan
// region's text and offset (scanText.ts) and feeds it here; this debounces,
// looks the text up, and opens the results as a child of the popup the
// pointer is in. Without Shift nothing happens, and releasing Shift closes
// nothing. One lookup is in flight at a time: a newer scan, leaving the
// scan region, or the parent popup closing aborts it, and a late result for
// a closed parent opens nothing (the stack refuses an unknown parent too).
import type { LookupResult } from '$lib/api/types';
import type { LookupFn } from './lookupCache';
import type { PopupStack } from './popupStack.svelte';
import type { PopupFrame } from './popupStackCore';

export const SCAN_DEBOUNCE_MS = 80;

export interface ScanRequest {
	/** The frame whose popup holds the scanned text. */
	parentId: number;
	lang: string;
	text: string;
	offset: number;
	/** Where code points [start,end) of `text` are on screen. */
	anchor: (start: number, end: number) => PopupFrame['anchor'];
}

export interface NestedScanDeps {
	lookup: LookupFn;
	/** Shift held during the pointer event being handled. */
	isShift: () => boolean;
	stack: Pick<PopupStack, 'frames' | 'open'>;
}

function sameSpot(a: ScanRequest, b: ScanRequest): boolean {
	return a.parentId === b.parentId && a.text === b.text && a.offset === b.offset;
}

export class NestedScan {
	#deps: NestedScanDeps;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#pending: ScanRequest | null = null;
	#inFlight: { req: ScanRequest; abort: AbortController } | null = null;
	/** The child this opened last: the pointer inside its word keeps it. */
	#child: { id: number; parentId: number; text: string; start: number; end: number } | null = null;

	constructor(deps: NestedScanDeps) {
		this.#deps = deps;
	}

	/** The pointer moved inside a popup, over `req` or over no scan region (null). */
	move(req: ScanRequest | null): void {
		if (!this.#deps.isShift()) return this.#cancelPending();
		if (!req) {
			this.#cancelPending();
			return this.#abort();
		}
		const child = this.#child;
		if (
			child &&
			this.#isOpen(child.id) &&
			child.parentId === req.parentId &&
			child.text === req.text &&
			req.offset >= child.start &&
			req.offset < child.end
		) {
			this.#cancelPending();
			return this.#abort();
		}
		if (this.#inFlight && sameSpot(this.#inFlight.req, req)) return this.#cancelPending();
		if (this.#pending && sameSpot(this.#pending, req)) return;
		// A new spot: the word of the lookup in flight was left.
		this.#cancelPending();
		this.#abort();
		this.#pending = req;
		this.#timer = setTimeout(() => {
			this.#pending = null;
			this.#timer = undefined;
			void this.#lookup(req);
		}, SCAN_DEBOUNCE_MS);
	}

	/** Drops pending and in-flight scans whose parent popup has closed. */
	prune(): void {
		if (this.#pending && !this.#isOpen(this.#pending.parentId)) this.#cancelPending();
		if (this.#inFlight && !this.#isOpen(this.#inFlight.req.parentId)) this.#abort();
	}

	/** Cancels everything (the whole stack closed). */
	cancel(): void {
		this.#cancelPending();
		this.#abort();
		this.#child = null;
	}

	#isOpen(id: number): boolean {
		return this.#deps.stack.frames.some((f) => f.id === id);
	}

	#cancelPending(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#pending = null;
	}

	#abort(): void {
		this.#inFlight?.abort.abort();
		this.#inFlight = null;
	}

	async #lookup(req: ScanRequest): Promise<void> {
		if (!this.#isOpen(req.parentId)) return;
		this.#abort();
		const flight = { req, abort: new AbortController() };
		this.#inFlight = flight;
		const { signal } = flight.abort;
		let results: LookupResult[];
		try {
			results = await this.#deps.lookup(req.lang, req.text, req.offset, undefined, signal);
		} catch {
			// A failed nested lookup stays quiet: the parent popup is still useful.
			results = [];
		}
		if (this.#inFlight !== flight || signal.aborted) return;
		this.#inFlight = null;
		const first = results[0];
		if (!first) return;
		const id = this.#deps.stack.open(
			{ anchor: req.anchor(first.start, first.end), text: first.matched, offset: req.offset, results },
			req.parentId
		);
		if (id !== null) {
			this.#child = { id, parentId: req.parentId, text: req.text, start: first.start, end: first.end };
		}
	}
}
