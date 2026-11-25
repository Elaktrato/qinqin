// What a tap is (tap to look up on touch screens): a touch or pen pointer
// released soon and near where it went down. DOM-free, so the rules run under
// vitest; the lookup controller feeds it the pointer events and the scrolls.
// A drag, a long press, a scroll, a pinch or a pointercancel (the browser took
// the gesture over, to pan or zoom) is no tap. Whether a tap leaves a
// selection, or landed on a control, the controller checks on the DOM.

/** The longest press that is still a tap (a longer one is a long press). */
export const TAP_MAX_MS = 500;
/** How far (CSS px, straight line) a tap may move from where it went down. */
export const TAP_MAX_MOVE_PX = 10;
/** After the release, the wait before a tap is resolved (the browser settles the selection first). */
export const TAP_SETTLE_MS = 30;
/** A click without a pointer type this soon after a touch release is that tap's click. */
export const TOUCH_CLICK_MS = 1000;
/** Controls a tap acts on, never looks up on. */
export const TAP_IGNORE =
	'a[href], button, input, select, textarea, label, summary, [role="button"], [contenteditable]:not([contenteditable="false"])';

/** One pointer event as the tracker needs it; `at` is the injected clock's time. */
export interface PointerSample {
	id: number;
	type: string;
	x: number;
	y: number;
	at: number;
	primary: boolean;
	button: number;
}

const tapping = (type: string): boolean => type === 'touch' || type === 'pen';

export class TapTracker {
	#start: PointerSample | null = null;

	/** A pointer went down: a touch or pen primary press starts a tap; any other pointer ends one. */
	down(s: PointerSample): void {
		if (this.#start) {
			// A second finger: a pinch or a two-finger gesture, not a tap.
			this.#start = null;
			return;
		}
		this.#start = tapping(s.type) && s.primary && s.button === 0 ? s : null;
	}

	move(s: PointerSample): void {
		const start = this.#start;
		if (start && s.id === start.id && Math.hypot(s.x - start.x, s.y - start.y) > TAP_MAX_MOVE_PX) this.#start = null;
	}

	/** The pointer lifted: the tap point when it was a tap, else null. */
	up(s: PointerSample): { x: number; y: number } | null {
		const start = this.#start;
		if (!start || s.id !== start.id) return null;
		this.#start = null;
		if (s.at - start.at > TAP_MAX_MS) return null;
		if (Math.hypot(s.x - start.x, s.y - start.y) > TAP_MAX_MOVE_PX) return null;
		return { x: s.x, y: s.y };
	}

	/** A pointercancel or a scroll: whatever was going on is no tap. */
	cancel(): void {
		this.#start = null;
	}
}

/**
 * touchClick tells a click that a touch or pen tap produced: by its own
 * pointer type (Chromium, so the Android WebView), else, for a click that has
 * none, by a touch or pen release less than TOUCH_CLICK_MS before it.
 */
export function touchClick(click: { pointerType?: string; at: number }, lastTouchUp: number | null): boolean {
	if (click.pointerType) return tapping(click.pointerType);
	return lastTouchUp !== null && click.at - lastTouchUp < TOUCH_CLICK_MS;
}
