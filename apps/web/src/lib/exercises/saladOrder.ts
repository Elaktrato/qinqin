// Word Salad (#291): the order of the answer row while tiles are dragged or moved by keyboard. Pure, no UI.
// A row is a list of tile ids (positions in the shuffled bank), so duplicate words stay distinct tiles.

/** `id` placed at position `at` (clamped to the row); an id already in the row is moved, never duplicated. */
export function insertAt(row: readonly number[], id: number, at: number): number[] {
	const rest = row.filter((other) => other !== id);
	const i = Math.max(0, Math.min(rest.length, Math.trunc(at)));
	return [...rest.slice(0, i), id, ...rest.slice(i)];
}

/** `id` moved to position `to` of the row without it (where the gap sits while it is dragged). */
export function moveTo(row: readonly number[], id: number, to: number): number[] {
	if (!row.includes(id)) return [...row];
	return insertAt(row, id, to);
}

/** `id` moved one place toward the start (-1) or the end (+1); null at the edge or for a tile not in the row. */
export function step(row: readonly number[], id: number, delta: -1 | 1): number[] | null {
	const i = row.indexOf(id);
	const to = i + delta;
	if (i === -1 || to < 0 || to >= row.length) return null;
	return insertAt(row, id, to);
}

/** How far (px) a pointer moves before a press becomes a drag; a finger wanders more than a mouse or pen. */
export const DRAG_SLOP = { mouse: 8, pen: 8, touch: 10 } as const;

/** True once a press has moved far enough to be a drag; below it the release is a tap. */
export function isDrag(dx: number, dy: number, pointerType: string): boolean {
	const slop = pointerType === 'touch' ? DRAG_SLOP.touch : DRAG_SLOP.mouse;
	return Math.hypot(dx, dy) >= slop;
}

/** A tile's box on screen (client coordinates). */
export interface TileBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/**
 * Where a pointer at (x, y) drops into a wrapped row of tiles, given the boxes of the tiles in row order (the
 * dragged tile left out): the line nearest the pointer, then the tiles of that line whose centre lies before it.
 */
export function insertionIndex(boxes: readonly TileBox[], x: number, y: number, rtl = false): number {
	if (boxes.length === 0) return 0;
	// Lines: runs of consecutive tiles whose vertical ranges overlap.
	const lines: { first: number; count: number; top: number; bottom: number }[] = [];
	boxes.forEach((b, i) => {
		const line = lines.at(-1);
		if (line !== undefined && b.top < line.bottom && b.bottom > line.top) {
			line.count += 1;
			line.top = Math.min(line.top, b.top);
			line.bottom = Math.max(line.bottom, b.bottom);
		} else lines.push({ first: i, count: 1, top: b.top, bottom: b.bottom });
	});
	const distance = (l: { top: number; bottom: number }) => (y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0);
	let line = lines[0];
	for (const l of lines) if (distance(l) < distance(line)) line = l;
	let before = 0;
	for (let i = line.first; i < line.first + line.count; i++) {
		const centre = (boxes[i].left + boxes[i].right) / 2;
		if (rtl ? centre > x : centre < x) before += 1;
	}
	return line.first + before;
}
