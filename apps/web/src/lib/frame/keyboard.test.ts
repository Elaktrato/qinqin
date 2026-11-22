import { describe, expect, it } from 'vitest';
import { KEYBOARD_MIN_PX, viewportShrunk } from './keyboard';

describe('viewportShrunk', () => {
	it('true when the keyboard covers the bottom of the window', () => {
		expect(viewportShrunk(800, { height: 450, scale: 1 })).toBe(true);
	});

	it('false for a browser toolbar sliding in, or with no visual viewport', () => {
		expect(viewportShrunk(800, { height: 800 - KEYBOARD_MIN_PX, scale: 1 })).toBe(false);
		expect(viewportShrunk(800, { height: 744, scale: 1 })).toBe(false);
		expect(viewportShrunk(800, null)).toBe(false);
		expect(viewportShrunk(0, { height: 0, scale: 1 })).toBe(false);
	});

	it('pinch zoom is not a keyboard (the visual viewport is smaller by its scale)', () => {
		expect(viewportShrunk(800, { height: 400, scale: 2 })).toBe(false);
		// Zoomed in and the keyboard open.
		expect(viewportShrunk(800, { height: 200, scale: 2 })).toBe(true);
	});
});
