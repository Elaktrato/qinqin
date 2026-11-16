// Geometry of the goal ring: an SVG circle stroked with a dash as long as
// its circumference, offset by the part not yet reached. Pure.

export function ringArc(fraction: number, radius: number): { circumference: number; dashOffset: number } {
	const circumference = 2 * Math.PI * radius;
	const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
	return { circumference, dashOffset: circumference * (1 - f) };
}
