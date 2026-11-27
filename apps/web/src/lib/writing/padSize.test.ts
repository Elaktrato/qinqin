import { describe, expect, it } from 'vitest';
import { padLimits, padSide } from './padSize';

const touch = padLimits(16, true);
const mouse = padLimits(16, false);

describe('padLimits', () => {
	it('is 10rem to 22.5rem on a touch screen and 10rem to 17.5rem with a mouse', () => {
		expect(touch).toEqual({ min: 160, max: 360 });
		expect(mouse).toEqual({ min: 160, max: 280 });
	});
	it('follows the root font size', () => {
		expect(padLimits(20, true)).toEqual({ min: 200, max: 450 });
	});
});

describe('padSide', () => {
	it('fills the width of a 360 px phone when there is height to spare', () => {
		// 328 px of content width, the pad at 200 px and 250 px of free height below the feedback line.
		expect(padSide({ width: 328, side: 200, slack: 250 }, touch)).toBe(328);
	});
	it('is never wider than its container, even below the minimum', () => {
		expect(padSide({ width: 140, side: 200, slack: 500 }, touch)).toBe(140);
	});
	it('shrinks to leave the feedback line above the dock', () => {
		// The feedback line ends 60 px below the free space: the pad gives up those 60 px.
		expect(padSide({ width: 328, side: 300, slack: -60 }, touch)).toBe(240);
	});
	it('reaches the same side from any starting size (one pass is the fixed point)', () => {
		// Below the pad nothing depends on its size, so side + slack is constant for one layout.
		const a = padSide({ width: 328, side: 200, slack: 80 }, touch);
		const b = padSide({ width: 328, side: 280, slack: 0 }, touch);
		expect(a).toBe(280);
		expect(b).toBe(a);
	});
	it('keeps the minimum on a landscape phone and lets the page scroll', () => {
		expect(padSide({ width: 700, side: 200, slack: -150 }, touch)).toBe(160);
	});
	it('stops at the maximum: about today on a desktop, the content width on a phone', () => {
		expect(padSide({ width: 508, side: 200, slack: 400 }, mouse)).toBe(280);
		expect(padSide({ width: 600, side: 200, slack: 400 }, touch)).toBe(360);
	});
	it('rounds down to whole pixels and ignores measurements that are not numbers', () => {
		expect(padSide({ width: 327.6, side: 200, slack: 300 }, touch)).toBe(327);
		expect(padSide({ width: 328, side: 200, slack: Number.NaN }, touch)).toBe(200);
		expect(padSide({ width: Number.NaN, side: 200, slack: 10 }, touch)).toBe(200);
	});
});
