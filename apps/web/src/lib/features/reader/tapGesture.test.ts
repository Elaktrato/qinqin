import { describe, expect, it } from 'vitest';
import { FLING_STOP_MS, TAP_MAX_MOVE_PX, TAP_MAX_MS, TOUCH_CLICK_MS, TapTracker, tapProbes, touchClick, type PointerSample } from './tapGesture';

const at = (over: Partial<PointerSample> = {}): PointerSample => ({
	id: 1,
	type: 'touch',
	x: 100,
	y: 200,
	at: 1000,
	primary: true,
	button: 0,
	...over
});

describe('TapTracker', () => {
	it('a quick release where the finger went down is a tap at the release point', () => {
		const tap = new TapTracker();
		tap.down(at());
		expect(tap.up(at({ x: 103, y: 202, at: 1120 }))).toEqual({ x: 103, y: 202 });
	});

	it('a pen taps too; a mouse never does', () => {
		const pen = new TapTracker();
		pen.down(at({ type: 'pen' }));
		expect(pen.up(at({ type: 'pen', at: 1100 }))).not.toBeNull();
		const mouse = new TapTracker();
		mouse.down(at({ type: 'mouse' }));
		expect(mouse.up(at({ type: 'mouse', at: 1100 }))).toBeNull();
	});

	it('holding to the limit is a tap; longer is a long press', () => {
		const tap = new TapTracker();
		tap.down(at());
		expect(tap.up(at({ at: 1000 + TAP_MAX_MS }))).not.toBeNull();
		tap.down(at());
		expect(tap.up(at({ at: 1000 + TAP_MAX_MS + 1 }))).toBeNull();
	});

	it('moving past the slop is a drag, even when the finger comes back', () => {
		const tap = new TapTracker();
		tap.down(at());
		tap.move(at({ x: 100 + TAP_MAX_MOVE_PX + 1, at: 1050 }));
		expect(tap.up(at({ at: 1100 }))).toBeNull();
		tap.down(at());
		tap.move(at({ x: 106, y: 208, at: 1050 }));
		expect(tap.up(at({ x: 106, y: 208, at: 1100 }))).not.toBeNull();
	});

	it('a release past the slop is no tap', () => {
		const tap = new TapTracker();
		tap.down(at());
		expect(tap.up(at({ y: 200 + TAP_MAX_MOVE_PX + 1, at: 1100 }))).toBeNull();
	});

	it('a scroll or a pointercancel in between is no tap', () => {
		const tap = new TapTracker();
		tap.down(at());
		tap.cancel();
		expect(tap.up(at({ at: 1100 }))).toBeNull();
	});

	it('a second finger (a pinch) cancels the first, and neither taps', () => {
		const tap = new TapTracker();
		tap.down(at());
		tap.down(at({ id: 2, primary: false, x: 300 }));
		expect(tap.up(at({ id: 2, primary: false, x: 300, at: 1100 }))).toBeNull();
		expect(tap.up(at({ at: 1100 }))).toBeNull();
	});

	it('another pointer moving or lifting does not touch the tracked one', () => {
		const tap = new TapTracker();
		tap.down(at());
		tap.move(at({ id: 9, type: 'mouse', x: 900 }));
		expect(tap.up(at({ id: 9, type: 'mouse', at: 1050 }))).toBeNull();
		expect(tap.up(at({ at: 1100 }))).not.toBeNull();
	});

	it('a secondary button or a non-primary pointer starts nothing', () => {
		const tap = new TapTracker();
		tap.down(at({ button: 2 }));
		expect(tap.up(at({ at: 1100 }))).toBeNull();
		tap.down(at({ primary: false }));
		expect(tap.up(at({ primary: false, at: 1100 }))).toBeNull();
	});

	it('a lost release does not eat the next tap: a fresh primary press starts over', () => {
		const tap = new TapTracker();
		tap.down(at());
		// The up never arrives (its target unmounted mid-gesture); a new finger lands.
		tap.down(at({ id: 2, at: 3000 }));
		expect(tap.up(at({ id: 2, at: 3080 }))).not.toBeNull();
	});

	it('a press that stops a scroll fling is no tap; one after the page settled is', () => {
		const tap = new TapTracker();
		for (let t = 840; t <= 984; t += 16) tap.scrolled(t);
		tap.down(at({ at: 984 + FLING_STOP_MS - 1 }));
		expect(tap.up(at({ at: 984 + FLING_STOP_MS + 60 }))).toBeNull();
		tap.down(at({ at: 984 + FLING_STOP_MS }));
		expect(tap.up(at({ at: 984 + FLING_STOP_MS + 60 }))).not.toBeNull();
	});

	it('a scroll during the press cancels it', () => {
		const tap = new TapTracker();
		tap.down(at());
		tap.scrolled(1040);
		expect(tap.up(at({ at: 1080 }))).toBeNull();
	});

	it('a release with nothing down is no tap, and a tap is reported once', () => {
		const tap = new TapTracker();
		expect(tap.up(at())).toBeNull();
		tap.down(at());
		expect(tap.up(at({ at: 1100 }))).not.toBeNull();
		expect(tap.up(at({ at: 1150 }))).toBeNull();
	});
});

describe('touchClick', () => {
	it('trusts the click’s own pointer type', () => {
		expect(touchClick({ pointerType: 'touch', detail: 1, at: 5000 }, null)).toBe(true);
		expect(touchClick({ pointerType: 'pen', detail: 1, at: 5000 }, null)).toBe(true);
		expect(touchClick({ pointerType: 'mouse', detail: 1, at: 5000 }, 4990)).toBe(false);
	});

	it('without a pointer type, a click soon after a touch release is the tap’s', () => {
		expect(touchClick({ pointerType: '', detail: 1, at: 5000 }, 5000 - TOUCH_CLICK_MS + 1)).toBe(true);
		expect(touchClick({ detail: 1, at: 5000 }, 5000 - TOUCH_CLICK_MS - 1)).toBe(false);
		expect(touchClick({ detail: 1, at: 5000 }, null)).toBe(false);
	});

	it('a keyboard click (detail 0) is never a tap’s, even right after a touch', () => {
		expect(touchClick({ pointerType: '', detail: 0, at: 500 }, 0)).toBe(false);
		expect(touchClick({ pointerType: 'touch', detail: 0, at: 500 }, 0)).toBe(false);
	});
});

describe('tapProbes', () => {
	it('tries the point first, then ever further above and below it up to the slack', () => {
		expect(tapProbes(10, 100)).toEqual([
			{ x: 10, y: 100 },
			{ x: 10, y: 96 },
			{ x: 10, y: 104 },
			{ x: 10, y: 92 },
			{ x: 10, y: 108 }
		]);
	});
});
