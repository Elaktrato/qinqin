import { resample } from './geometry';
import { MATCH } from './params';
import type { Pt } from './strokes';

export interface PointerLike {
	isPrimary: boolean;
	pointerType: string;
	button: number;
}

/** Primary pointer only; mouse needs the main button. Pen and touch have button 0 on contact. */
export function acceptsPointerDown(e: PointerLike): boolean {
	if (!e.isPrimary) return false;
	if (e.pointerType === 'mouse' && e.button !== 0) return false;
	return true;
}

/**
 * Palm rejection: once a pen has touched the pad, touch is ignored for good (a resting palm
 * must not draw). Create one gate per pad and call it for every pointerdown.
 */
export function createPalmGate(): (e: PointerLike) => boolean {
	let penSeen = false;
	return (e) => {
		if (e.pointerType === 'pen') penSeen = true;
		if (penSeen && e.pointerType === 'touch') return false;
		return acceptsPointerDown(e);
	};
}

/**
 * Client coordinates to pad-unit coordinates (0..1 across the pad), or null while the pad has
 * no size (not laid out yet, or hidden): such a point would be Infinity or NaN.
 */
export function toPadUnit(
	clientX: number,
	clientY: number,
	rect: { left: number; top: number; width: number; height: number }
): Pt | null {
	if (!(rect.width > 0) || !(rect.height > 0)) return null;
	const p = { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
	return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

/** Append a point unless it is missing, not finite, or repeats the previous one. */
export function appendInk(ink: Pt[], p: Pt | null): boolean {
	if (p === null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
	const last = ink.at(-1);
	if (last && last.x === p.x && last.y === p.y) return false;
	ink.push(p);
	return true;
}

/** Interpolate the ink towards the reference path (both resampled to the same count). */
export function morphPath(ink: readonly Pt[], target: readonly Pt[], t: number): Pt[] {
	const k = Math.min(1, Math.max(0, t));
	if (ink.length < 2 || target.length < 2) return [...target];
	const a = resample(ink, MATCH.resample);
	const b = resample(target, MATCH.resample);
	return a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k }));
}
