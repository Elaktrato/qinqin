export type Pt = { x: number; y: number };

export interface CharStrokes {
	char: string;
	medians: Pt[][];
	outlines: string[];
}

/** Stroke data uses a 1024 box, y up, baseline offset 900. Unit coords: y down. */
export function toUnit(p: readonly [number, number]): Pt {
	return { x: p[0] / 1024, y: (900 - p[1]) / 1024 };
}

function isPoint(p: unknown): p is [number, number] {
	return (
		Array.isArray(p) &&
		p.length >= 2 &&
		typeof p[0] === 'number' &&
		typeof p[1] === 'number' &&
		Number.isFinite(p[0]) &&
		Number.isFinite(p[1])
	);
}

export function parseStrokeData(char: string, json: unknown): CharStrokes | null {
	if (typeof json !== 'object' || json === null) return null;
	const { strokes, medians } = json as { strokes?: unknown; medians?: unknown };
	if (!Array.isArray(strokes) || !Array.isArray(medians)) return null;
	if (strokes.length === 0 || strokes.length !== medians.length) return null;
	if (!strokes.every((s) => typeof s === 'string')) return null;
	const out: Pt[][] = [];
	for (const m of medians) {
		if (!Array.isArray(m) || m.length === 0 || !m.every(isPoint)) return null;
		out.push(m.map((p) => toUnit(p as [number, number])));
	}
	return { char, medians: out, outlines: strokes as string[] };
}
