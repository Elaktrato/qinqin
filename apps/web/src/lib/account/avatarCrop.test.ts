import { describe, expect, it } from 'vitest';
import {
	MAX_ZOOM,
	acceptedPicture,
	cropSide,
	imageBox,
	initialCrop,
	keyStep,
	panBy,
	pinchZoom,
	sourceRect,
	wheelZoom,
	zoomTo,
	type Crop
} from './avatarCrop';

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('initialCrop', () => {
	it('fits the short side into the view and centres the square (cover)', () => {
		const c = initialCrop(400, 200, 200);
		expect(c.zoom).toBe(1);
		expect(cropSide(c)).toBe(200);
		expect(sourceRect(c)).toEqual({ sx: 100, sy: 0, size: 200 });
		// Drawn: 400×200 image at scale 1, shifted so its centre is the view's.
		expect(imageBox(c)).toEqual({ left: -100, top: 0, width: 400, height: 200 });
	});

	it('works for portrait and tiny images (scaled up to cover)', () => {
		const tall = initialCrop(300, 900, 240);
		expect(sourceRect(tall)).toEqual({ sx: 0, sy: 300, size: 300 });
		const tiny = initialCrop(20, 10, 200);
		expect(sourceRect(tiny)).toEqual({ sx: 5, sy: 0, size: 10 });
		expect(imageBox(tiny).height).toBe(200);
	});
});

describe('panBy (drag)', () => {
	it('moves the picture with the pointer: dragging right shows more of the left', () => {
		const c = panBy(initialCrop(400, 200, 200), 40, 0);
		expect(sourceRect(c).sx).toBe(60);
		expect(imageBox(c).left).toBe(-60);
	});

	it('never uncovers the square: the crop stays inside the picture', () => {
		const start = initialCrop(400, 200, 200);
		expect(sourceRect(panBy(start, 1000, 1000))).toEqual({ sx: 0, sy: 0, size: 200 });
		expect(sourceRect(panBy(start, -1000, -1000))).toEqual({ sx: 200, sy: 0, size: 200 });
	});

	it('moves in picture pixels scaled by the zoom', () => {
		const zoomed = zoomTo(initialCrop(400, 400, 200), 2);
		// scale = 200/400 * 2 = 1: 30 view px are 30 picture px
		const before = sourceRect(zoomed).sx;
		expect(sourceRect(panBy(zoomed, -30, 0)).sx).toBe(before + 30);
	});
});

describe('zoomTo, wheelZoom and pinchZoom', () => {
	it('keeps the zoom between 1 and MAX_ZOOM', () => {
		const c = initialCrop(400, 400, 200);
		expect(zoomTo(c, 0.2).zoom).toBe(1);
		expect(zoomTo(c, 99).zoom).toBe(MAX_ZOOM);
	});

	it('zooms around the centre by default and around a point when given one', () => {
		const c = initialCrop(400, 400, 200);
		const centred = zoomTo(c, 2);
		expect(sourceRect(centred)).toEqual({ sx: 100, sy: 100, size: 200 });
		// The picture point under the view's top-left corner stays there.
		const corner = zoomTo(c, 2, { x: 0, y: 0 });
		expect(sourceRect(corner)).toEqual({ sx: 0, sy: 0, size: 200 });
	});

	it('wheel up zooms in, wheel down zooms out', () => {
		const c = initialCrop(400, 400, 200);
		expect(wheelZoom(c, -100).zoom).toBeGreaterThan(1);
		expect(wheelZoom(zoomTo(c, 2), 100).zoom).toBeLessThan(2);
	});

	it('pinch zooms by the ratio of the finger distances from where the pinch began', () => {
		const c = initialCrop(400, 400, 200);
		near(pinchZoom(c, { zoom: 1, distance: 100 }, 200, { x: 100, y: 100 }).zoom, 2);
		near(pinchZoom(zoomTo(c, 3), { zoom: 3, distance: 100 }, 50, { x: 100, y: 100 }).zoom, 1.5);
	});

	it('zooming out at an edge pulls the square back inside the picture', () => {
		const edge = panBy(zoomTo(initialCrop(400, 400, 200), 4), 1000, 0); // at the left edge
		const out = zoomTo(edge, 1);
		expect(sourceRect(out)).toEqual({ sx: 0, sy: 0, size: 400 });
	});
});

describe('keyStep (keyboard)', () => {
	const c: Crop = zoomTo(initialCrop(400, 400, 200), 2);
	it('arrow keys move the picture like a drag, Shift moves further', () => {
		expect(sourceRect(keyStep(c, 'ArrowRight', false)!).sx).toBe(sourceRect(c).sx - 10);
		expect(sourceRect(keyStep(c, 'ArrowLeft', false)!).sx).toBe(sourceRect(c).sx + 10);
		expect(sourceRect(keyStep(c, 'ArrowDown', false)!).sy).toBe(sourceRect(c).sy - 10);
		expect(sourceRect(keyStep(c, 'ArrowUp', true)!).sy).toBe(sourceRect(c).sy + 50);
	});

	it('+ and - zoom; Home and End go to the zoom limits; other keys are not handled', () => {
		expect(keyStep(c, '+', false)!.zoom).toBeGreaterThan(2);
		expect(keyStep(c, '=', false)!.zoom).toBeGreaterThan(2);
		expect(keyStep(c, '-', false)!.zoom).toBeLessThan(2);
		expect(keyStep(c, 'Home', false)!.zoom).toBe(1);
		expect(keyStep(c, 'End', false)!.zoom).toBe(MAX_ZOOM);
		expect(keyStep(c, 'a', false)).toBeNull();
		expect(keyStep(c, 'Enter', false)).toBeNull();
	});
});

describe('sourceRect', () => {
	it('is whole pixels inside the picture at every zoom and position', () => {
		let c = initialCrop(1234, 777, 260);
		for (const step of [() => zoomTo(c, 1.37), () => panBy(c, 13.3, -7.1), () => zoomTo(c, 3.91, { x: 17, y: 230 }), () => panBy(c, -999, 999)]) {
			c = step();
			const r = sourceRect(c);
			for (const v of [r.sx, r.sy, r.size]) expect(Number.isInteger(v)).toBe(true);
			expect(r.size).toBeGreaterThan(0);
			expect(r.sx).toBeGreaterThanOrEqual(0);
			expect(r.sy).toBeGreaterThanOrEqual(0);
			expect(r.sx + r.size).toBeLessThanOrEqual(1234);
			expect(r.sy + r.size).toBeLessThanOrEqual(777);
		}
	});
});

describe('acceptedPicture', () => {
	it('takes JPEG, PNG and WebP by type, and by name when there is no type', () => {
		for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(acceptedPicture({ type, name: 'x' })).toBe(true);
		for (const type of ['image/gif', 'image/svg+xml', 'image/avif', 'image/bmp', 'image/heic', 'text/plain'])
			expect(acceptedPicture({ type, name: 'x.jpg' })).toBe(false);
		expect(acceptedPicture({ type: '', name: 'IMG_1.JPEG' })).toBe(true);
		expect(acceptedPicture({ type: '', name: 'a.webp' })).toBe(true);
		expect(acceptedPicture({ type: '', name: 'a.gif' })).toBe(false);
		expect(acceptedPicture({ type: '', name: 'jpg' })).toBe(false);
	});
});
