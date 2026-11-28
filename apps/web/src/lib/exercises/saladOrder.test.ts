import { describe, expect, it } from 'vitest';
import { insertAt, insertionIndex, isDrag, moveTo, step, type TileBox } from './saladOrder';

describe('insertAt', () => {
	it('puts a tile at any position, clamped to the row', () => {
		expect(insertAt([1, 2, 3], 9, 0)).toEqual([9, 1, 2, 3]);
		expect(insertAt([1, 2, 3], 9, 2)).toEqual([1, 2, 9, 3]);
		expect(insertAt([1, 2, 3], 9, 3)).toEqual([1, 2, 3, 9]);
		expect(insertAt([1, 2, 3], 9, 99)).toEqual([1, 2, 3, 9]);
		expect(insertAt([1, 2, 3], 9, -4)).toEqual([9, 1, 2, 3]);
	});

	it('never duplicates a tile already in the row', () => {
		expect(insertAt([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
	});
});

describe('moveTo', () => {
	// `to` counts in the row without the moved tile (where the gap sits while dragging).
	it('moves a tile to the gap position', () => {
		expect(moveTo([1, 2, 3, 4], 1, 2)).toEqual([2, 3, 1, 4]);
		expect(moveTo([1, 2, 3, 4], 4, 0)).toEqual([4, 1, 2, 3]);
		expect(moveTo([1, 2, 3, 4], 2, 1)).toEqual([1, 2, 3, 4]);
		expect(moveTo([1, 2, 3, 4], 2, 3)).toEqual([1, 3, 4, 2]);
	});

	it('leaves the row alone for a tile that is not in it', () => {
		expect(moveTo([1, 2], 7, 0)).toEqual([1, 2]);
	});
});

describe('step', () => {
	it('moves a tile one place either way', () => {
		expect(step([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
		expect(step([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
	});

	it('is null at the edge or for an unknown tile', () => {
		expect(step([1, 2, 3], 1, -1)).toBeNull();
		expect(step([1, 2, 3], 3, 1)).toBeNull();
		expect(step([1, 2, 3], 8, 1)).toBeNull();
	});
});

describe('isDrag', () => {
	it('a small wobble is a tap, a real move is a drag', () => {
		expect(isDrag(3, 4, 'mouse')).toBe(false); // 5 px
		expect(isDrag(6, 6, 'mouse')).toBe(true); // 8.5 px
		expect(isDrag(6, 6, 'touch')).toBe(false); // a finger wanders more
		expect(isDrag(0, 11, 'touch')).toBe(true);
		expect(isDrag(8, 0, 'pen')).toBe(true);
	});
});

// Two lines of tiles 40 px wide, 40 px high, 10 px apart.
const box = (left: number, top: number): TileBox => ({ left, right: left + 40, top, bottom: top + 40 });
const twoLines = [box(0, 0), box(50, 0), box(100, 0), box(0, 50), box(50, 50)];

describe('insertionIndex', () => {
	it('is 0 in an empty row', () => {
		expect(insertionIndex([], 10, 10)).toBe(0);
	});

	it('counts the tiles before the pointer on its line', () => {
		expect(insertionIndex(twoLines, 5, 20)).toBe(0);
		expect(insertionIndex(twoLines, 30, 20)).toBe(1);
		expect(insertionIndex(twoLines, 80, 20)).toBe(2);
		expect(insertionIndex(twoLines, 200, 20)).toBe(3);
		expect(insertionIndex(twoLines, 5, 70)).toBe(3);
		expect(insertionIndex(twoLines, 60, 70)).toBe(4);
		expect(insertionIndex(twoLines, 300, 70)).toBe(5);
	});

	it('takes the nearest line when the pointer is between or outside the lines', () => {
		expect(insertionIndex(twoLines, 30, -30)).toBe(1);
		expect(insertionIndex(twoLines, 30, 200)).toBe(4);
		expect(insertionIndex(twoLines, 30, 44)).toBe(1); // nearer the first line
		expect(insertionIndex(twoLines, 30, 47)).toBe(4);
	});

	it('mirrors in a right-to-left row', () => {
		// The first tile is on the right.
		const rtl = [box(100, 0), box(50, 0), box(0, 0)];
		expect(insertionIndex(rtl, 130, 20, true)).toBe(0);
		expect(insertionIndex(rtl, 60, 20, true)).toBe(2);
		expect(insertionIndex(rtl, -10, 20, true)).toBe(3);
	});
});
