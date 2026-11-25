// The pointer inside the lookup popups (the DOM side of nested scanning).
// Each popup delegates its pointerenter/leave/move here. Entering and
// leaving feed the hover grace (a popup the pointer is in stays open); a
// move with Shift held resolves the character under the pointer to a
// data-scan region (scanText.ts) and hands it to the DOM-free NestedScan.
// The event's shiftKey is the gate; window key events only keep `shiftHeld`
// for the UI hint, and pressing Shift with the pointer resting in a popup
// scans right there.
import { caretUnderPoint, rangeForText } from './dom';
import type { LookupFn } from './lookupCache';
import { NestedScan } from './nestedScan';
import type { PopupStack } from './popupStack.svelte';
import type { PopupFrame } from './popupStackCore';
import { scanTarget } from './scanText';

const POPUP = '[data-lookup-popup]';

/**
 * inPopup reports whether an event target is inside a lookup popup, or inside
 * the phone's lookup sheet (a dialog holding one; its scrolling body and drag
 * handle sit around the popup content). The sheet's backdrop is the dialog
 * element itself: a tap there is outside.
 */
export function inPopup(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	if (target.closest(POPUP) !== null) return true;
	const sheet = target.closest('dialog');
	return sheet !== null && sheet !== target && sheet.querySelector(POPUP) !== null;
}

/** onLookupBackdrop reports whether a target is the phone lookup sheet's backdrop (the dialog element itself). */
export function onLookupBackdrop(target: EventTarget | null): boolean {
	return target instanceof HTMLDialogElement && target.querySelector(POPUP) !== null;
}

/** anchorOf turns a viewport rectangle into a popup frame anchor. */
export function anchorOf(rect: DOMRect): PopupFrame['anchor'] {
	return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** A pointer position inside the popup of frame `frameId` (element `root`). */
interface PopupPoint {
	x: number;
	y: number;
	frameId: number;
	root: HTMLElement;
}

export interface PopupPointerDeps {
	lookup: LookupFn;
	stack: PopupStack;
	/** The pointer entered a popup / left the last one (hover grace). */
	entered: () => void;
	left: () => void;
}

export class PopupPointer {
	/** Shift is held (window key events): a UI hint only, never the gate. */
	shiftHeld = $state(false);

	#deps: PopupPointerDeps;
	#scan: NestedScan;
	/** Shift during the pointer event being handled: the scan gate. */
	#eventShift = false;
	#at: PopupPoint | null = null;

	constructor(deps: PopupPointerDeps) {
		this.#deps = deps;
		this.#scan = new NestedScan({ lookup: deps.lookup, isShift: () => this.#eventShift, stack: deps.stack });
	}

	enter = (e: PointerEvent): void => {
		if (e.pointerType === 'mouse') this.#deps.entered();
	};

	leave = (e: PointerEvent): void => {
		// Into another popup of the stack: still inside.
		if (e.pointerType !== 'mouse' || inPopup(e.relatedTarget)) return;
		this.#at = null;
		this.#deps.left();
		this.#eventShift = e.shiftKey;
		this.#scan.move(null);
	};

	move = (e: PointerEvent, frameId: number): void => {
		if (e.pointerType !== 'mouse' || !(e.currentTarget instanceof HTMLElement)) return;
		this.#at = { x: e.clientX, y: e.clientY, frameId, root: e.currentTarget };
		this.#scanAt(this.#at, e.shiftKey);
	};

	/**
	 * Window keydown/keyup. Releasing Shift closes nothing; it only drops a
	 * scan still debouncing (one already sent may complete).
	 */
	key = (e: KeyboardEvent): void => {
		if (e.key !== 'Shift') return;
		this.shiftHeld = e.type === 'keydown';
		const at = this.#at;
		if (e.type === 'keydown' && !e.repeat && at?.root.isConnected) this.#scanAt(at, true);
		if (e.type === 'keyup') this.#scan.releaseShift();
	};

	/** The window lost focus: its keyup for Shift may never come. */
	blur = (): void => {
		this.shiftHeld = false;
		this.#scan.releaseShift();
	};

	/** Some popups closed: drop the scans their popups started. */
	prune(): void {
		this.#scan.prune();
	}

	/** The whole stack closed. */
	cancel(): void {
		this.#at = null;
		this.#scan.cancel();
	}

	#scanAt(at: PopupPoint, shift: boolean): void {
		this.#eventShift = shift;
		if (!shift) return this.#scan.move(null);
		const caret = caretUnderPoint(at.x, at.y);
		const found = caret && scanTarget(at.root, caret.node, caret.offset);
		if (!found) return this.#scan.move(null);
		this.#scan.move({
			parentId: at.frameId,
			lang: found.lang,
			text: found.text,
			offset: found.offset,
			anchor: (start, end) => anchorOf(rangeForText(found.element, start, end).getBoundingClientRect())
		});
	}
}
