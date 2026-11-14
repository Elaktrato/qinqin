import type { Pt } from './strokes';

export function dist(a: Pt, b: Pt): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pathLength(points: readonly Pt[]): number {
	let sum = 0;
	for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i]);
	return sum;
}

export function resample(points: readonly Pt[], n: number): Pt[] {
	if (points.length === 0 || n <= 0) return [];
	const total = pathLength(points);
	if (points.length === 1 || total === 0 || n === 1) {
		return Array.from({ length: n }, () => ({ ...points[0] }));
	}
	const step = total / (n - 1);
	const out: Pt[] = [{ ...points[0] }];
	let seg = 1;
	let segStart = 0; // path length at points[seg - 1]
	for (let k = 1; k < n - 1; k++) {
		const target = k * step;
		while (seg < points.length - 1 && segStart + dist(points[seg - 1], points[seg]) < target) {
			segStart += dist(points[seg - 1], points[seg]);
			seg++;
		}
		const a = points[seg - 1];
		const b = points[seg];
		const len = dist(a, b);
		const t = len === 0 ? 0 : Math.min(1, Math.max(0, (target - segStart) / len));
		out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
	}
	out.push({ ...points[points.length - 1] });
	return out;
}

export function centroid(points: readonly Pt[]): Pt {
	if (points.length === 0) return { x: 0, y: 0 };
	let x = 0;
	let y = 0;
	for (const p of points) {
		x += p.x;
		y += p.y;
	}
	return { x: x / points.length, y: y / points.length };
}

export function rmsRadius(points: readonly Pt[], c: Pt = centroid(points)): number {
	if (points.length === 0) return 0;
	let s = 0;
	for (const p of points) s += (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
	return Math.sqrt(s / points.length);
}

/** Concatenation; the end of path i connects straight to the start of path i+1. */
export function joinPaths(paths: readonly (readonly Pt[])[]): Pt[] {
	return paths.flatMap((p) => [...p]);
}
