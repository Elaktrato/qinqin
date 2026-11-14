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

/** Client coordinates to pad-unit coordinates (0..1 across the pad). */
export function toPadUnit(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Pt {
	return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

/** Append a point unless it repeats the previous one. */
export function appendInk(ink: Pt[], p: Pt): boolean {
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
