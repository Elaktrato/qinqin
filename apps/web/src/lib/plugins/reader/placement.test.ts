import { describe, expect, it } from 'vitest';
import { placePopup } from './placement';

const viewport = { width: 800, height: 600 };
const size = { width: 300, height: 200 };

describe('placePopup', () => {
	it('places the popup below the anchor, aligned to its left edge', () => {
		expect(placePopup({ x: 100, y: 100, w: 40, h: 20 }, size, viewport)).toEqual({
			left: 100,
			top: 126,
			maxHeight: 466
		});
	});

	it('flips above the anchor when there is no room below', () => {
		expect(placePopup({ x: 100, y: 500, w: 40, h: 20 }, size, viewport)).toEqual({
			left: 100,
			top: 294,
			maxHeight: 486
		});
	});

	it('takes the larger side with a capped height when it fits on neither', () => {
		// Below: 600 - 8 - 176 = 416 px; above: 150 - 6 - 8 = 136 px.
		expect(placePopup({ x: 100, y: 150, w: 40, h: 20 }, { width: 300, height: 500 }, viewport)).toEqual({
			left: 100,
			top: 176,
			maxHeight: 416
		});
		// Below: 600 - 8 - 426 = 166 px; above: 400 - 6 - 8 = 386 px.
		expect(placePopup({ x: 100, y: 400, w: 40, h: 20 }, { width: 300, height: 500 }, viewport)).toEqual({
			left: 100,
			top: 8,
			maxHeight: 386
		});
	});

	it('keeps a capped popup where it is once its measured height fits', () => {
		expect(placePopup({ x: 100, y: 400, w: 40, h: 20 }, { width: 300, height: 386 }, viewport)).toEqual({
			left: 100,
			top: 8,
			maxHeight: 386
		});
	});

	it('clamps horizontally into the viewport', () => {
		expect(placePopup({ x: 700, y: 100, w: 40, h: 20 }, size, viewport).left).toBe(492);
		expect(placePopup({ x: -50, y: 100, w: 40, h: 20 }, size, viewport).left).toBe(8);
	});
});
