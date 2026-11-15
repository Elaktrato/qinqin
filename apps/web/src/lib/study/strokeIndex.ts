// Which glyphs have stroke-order data, known synchronously. The list is
// generated from hanzi-writer-data (scripts/prepare-stroke-index.mjs) and
// committed; the level planner uses it so a glyph that definitely has no
// stroke data never takes a writing slot.

import index from './strokeIndex.json';

const RANGES = index.ranges as unknown as readonly (readonly [number, number])[];

/** hasStrokeData: the first code point of `glyph` has a stroke file. */
export function hasStrokeData(glyph: string): boolean {
	const cp = glyph.codePointAt(0);
	if (cp === undefined) return false;
	let lo = 0;
	let hi = RANGES.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const [start, end] = RANGES[mid];
		if (cp < start) hi = mid - 1;
		else if (cp > end) lo = mid + 1;
		else return true;
	}
	return false;
}

/** How many code points the index holds. */
export function strokeIndexCount(): number {
	return index.count;
}
