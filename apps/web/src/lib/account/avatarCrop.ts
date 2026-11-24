// The square crop of a profile picture (#189), pure: the picture is drawn to
// cover a square view (its short side fills the view at zoom 1), the person
// drags it, zooms it (slider, wheel, pinch, keys) and the square in the view
// is what is uploaded. Every function returns a new Crop; the crop square
// always stays inside the picture.

export const MAX_ZOOM = 4;

/** A crop: the picture's size, the view's side (CSS px), the zoom and the crop centre in picture px. */
export interface Crop {
	readonly width: number;
	readonly height: number;
	readonly view: number;
	readonly zoom: number;
	readonly cx: number;
	readonly cy: number;
}

export interface Point {
	x: number;
	y: number;
}

/** The picture's scale on screen: view px per picture px. */
function scale(c: Crop): number {
	return (c.view / Math.min(c.width, c.height)) * c.zoom;
}

/** cropSide: the side of the crop square in picture px. */
export function cropSide(c: Crop): number {
	return Math.min(c.width, c.height) / c.zoom;
}

function clamp(c: Crop): Crop {
	const zoom = Math.min(MAX_ZOOM, Math.max(1, c.zoom));
	const half = Math.min(c.width, c.height) / zoom / 2;
	return {
		...c,
		zoom,
		cx: Math.min(c.width - half, Math.max(half, c.cx)),
		cy: Math.min(c.height - half, Math.max(half, c.cy))
	};
}

/** initialCrop: zoom 1, the centre square. */
export function initialCrop(width: number, height: number, view: number): Crop {
	return { width, height, view, zoom: 1, cx: width / 2, cy: height / 2 };
}

/** panBy: a drag of (dx, dy) view px; the picture follows the pointer. */
export function panBy(c: Crop, dx: number, dy: number): Crop {
	const s = scale(c);
	return clamp({ ...c, cx: c.cx - dx / s, cy: c.cy - dy / s });
}

/** zoomTo: the new zoom, keeping the picture point under `anchor` (view px; default the centre) where it is. */
export function zoomTo(c: Crop, zoom: number, anchor: Point = { x: c.view / 2, y: c.view / 2 }): Crop {
	const before = scale(c);
	const ix = c.cx + (anchor.x - c.view / 2) / before;
	const iy = c.cy + (anchor.y - c.view / 2) / before;
	const next = clamp({ ...c, zoom });
	const after = scale(next);
	return clamp({ ...next, cx: ix - (anchor.x - c.view / 2) / after, cy: iy - (anchor.y - c.view / 2) / after });
}

/** wheelZoom: a wheel turn (deltaY < 0 zooms in) around `anchor`. */
export function wheelZoom(c: Crop, deltaY: number, anchor?: Point): Crop {
	return zoomTo(c, c.zoom * Math.exp(-deltaY * 0.002), anchor);
}

/** pinchZoom: two fingers now `distance` apart, the pinch having begun at `start`. */
export function pinchZoom(c: Crop, start: { zoom: number; distance: number }, distance: number, mid: Point): Crop {
	if (start.distance <= 0) return c;
	return zoomTo(c, (start.zoom * distance) / start.distance, mid);
}

const STEP = 10;
const BIG_STEP = 50;
const ZOOM_STEP = 1.1;

/** keyStep: what a key does on the focused crop area, or null when it does nothing there. */
export function keyStep(c: Crop, key: string, shift: boolean): Crop | null {
	const d = shift ? BIG_STEP : STEP;
	switch (key) {
		case 'ArrowLeft':
			return panBy(c, -d, 0);
		case 'ArrowRight':
			return panBy(c, d, 0);
		case 'ArrowUp':
			return panBy(c, 0, -d);
		case 'ArrowDown':
			return panBy(c, 0, d);
		case '+':
		case '=':
			return zoomTo(c, c.zoom * ZOOM_STEP);
		case '-':
		case '_':
			return zoomTo(c, c.zoom / ZOOM_STEP);
		case 'Home':
			return zoomTo(c, 1);
		case 'End':
			return zoomTo(c, MAX_ZOOM);
		default:
			return null;
	}
}

/** sourceRect: the crop square in whole picture px, inside the picture (for drawImage). */
export function sourceRect(c: Crop): { sx: number; sy: number; size: number } {
	const size = Math.max(1, Math.min(c.width, c.height, Math.round(cropSide(c))));
	const sx = Math.min(c.width - size, Math.max(0, Math.round(c.cx - size / 2)));
	const sy = Math.min(c.height - size, Math.max(0, Math.round(c.cy - size / 2)));
	return { sx, sy, size };
}

/** imageBox: where the whole picture is drawn in the view (CSS px). */
export function imageBox(c: Crop): { left: number; top: number; width: number; height: number } {
	const s = scale(c);
	return { left: c.view / 2 - c.cx * s, top: c.view / 2 - c.cy * s, width: c.width * s, height: c.height * s };
}

const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * acceptedPicture: a file the server takes, by its type (JPEG, PNG, WebP), or
 * by its name when the picker gave no type. The server still judges the
 * content.
 */
export function acceptedPicture(file: { type: string; name: string }): boolean {
	if (file.type) return PICTURE_TYPES.includes(file.type);
	return /\.(jpe?g|png|webp)$/i.test(file.name);
}
