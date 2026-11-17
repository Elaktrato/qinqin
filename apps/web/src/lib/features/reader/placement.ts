import type { PopupFrame } from './popupStackCore';

const GAP = 6;
const MARGIN = 8;

/**
 * placePopup puts a popup of `size` (its rendered border-box) below its
 * anchor (viewport coordinates), or above it when it only fits there; when
 * it fits on neither side it takes the larger one. `maxHeight` is the room
 * on the chosen side: the popup scrolls inside it rather than leaving the
 * viewport (where its controls could not be reached). The measured height
 * then fits the chosen side, so re-placing with it is stable. Clamped
 * inside the viewport horizontally.
 */
export function placePopup(
	anchor: PopupFrame['anchor'],
	size: { width: number; height: number },
	viewport: { width: number; height: number }
): { left: number; top: number; maxHeight: number } {
	const left = Math.max(MARGIN, Math.min(anchor.x, viewport.width - size.width - MARGIN));
	const below = anchor.y + anchor.h + GAP;
	const roomBelow = viewport.height - MARGIN - below;
	const roomAbove = anchor.y - GAP - MARGIN;
	const fitsBelow = size.height <= roomBelow;
	const fitsAbove = size.height <= roomAbove;
	if (fitsBelow || (!fitsAbove && roomBelow >= roomAbove)) {
		return { left, top: below, maxHeight: Math.max(0, roomBelow) };
	}
	const height = Math.min(size.height, roomAbove);
	return { left, top: Math.max(MARGIN, anchor.y - GAP - height), maxHeight: Math.max(0, roomAbove) };
}
