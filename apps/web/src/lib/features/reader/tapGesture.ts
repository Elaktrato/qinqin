// What a tap is (tap to look up on touch screens): a touch or pen pointer
// released soon and near where it went down. DOM-free, so the rules run under
// vitest; the lookup controller feeds it the pointer events and the scrolls.
// A drag, a long press, a scroll, a pinch or a pointercancel (the browser took
// the gesture over, to pan or zoom) is no tap. Whether a tap leaves a
// selection, or landed on a control, the controller checks on the DOM.
// A press that lands while the page is still scrolling (a fling) stops the
// scroll and is no tap either.

/** The longest press that is still a tap (a longer one is a long press). */
export const TAP_MAX_MS = 500;
/** How far (CSS px, straight line) a tap may move from where it went down. */
export const TAP_MAX_MOVE_PX = 10;
/** After the release, the wait before a tap is resolved (the browser settles the selection first). */
export const TAP_SETTLE_MS = 30;
/** A click without a pointer type this soon after a touch release is that tap's click. */
export const TOUCH_CLICK_MS = 1000;
/** A press this soon after the last scroll event stops a fling: no tap. */
export const FLING_STOP_MS = 150;
/** How far above and below a tap point a tap still finds a character (CSS px): the line gap. */
export const TAP_SLACK_PX = 8;
const TAP_SLACK_STEP_PX = 4;
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
	#lastScroll: number | null = null;

	/**
	 * A pointer went down. A primary touch or pen press starts a fresh tap
	 * (whatever was tracked before: its release may never have arrived); a
	 * non-primary one is a second finger (a pinch), which ends the tap. A
	 * press that stops a fling (a scroll less than FLING_STOP_MS before it)
	 * starts nothing.
	 */
	down(s: PointerSample): void {
		if (!s.primary) {
			this.#start = null;
			return;
		}
		const flinging = this.#lastScroll !== null && s.at - this.#lastScroll < FLING_STOP_MS;
		this.#start = tapping(s.type) && s.button === 0 && !flinging ? s : null;
	}

	/** The page (or anything in it) scrolled at `at`: a press in progress is no tap, nor is one landing soon. */
	scrolled(at: number): void {
		this.#lastScroll = at;
		this.#start = null;
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
 * none, by a touch or pen release less than TOUCH_CLICK_MS before it. A
 * click with detail 0 (the keyboard, or a script) never is one.
 */
export function touchClick(
	click: { pointerType?: string; detail: number; at: number },
	lastTouchUp: number | null
): boolean {
	if (click.detail === 0) return false;
	if (click.pointerType) return tapping(click.pointerType);
	return lastTouchUp !== null && click.at - lastTouchUp < TOUCH_CLICK_MS;
}

/**
 * tapProbes lists the points a tap tries in turn: the point itself, then
 * ever further above and below it up to TAP_SLACK_PX, so a finger that
 * lands in the gap between two lines still finds the nearer line's character.
 */
export function tapProbes(x: number, y: number): { x: number; y: number }[] {
	const out = [{ x, y }];
	for (let d = TAP_SLACK_STEP_PX; d <= TAP_SLACK_PX; d += TAP_SLACK_STEP_PX) out.push({ x, y: y - d }, { x, y: y + d });
	return out;
}
