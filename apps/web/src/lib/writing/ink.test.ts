import { describe, expect, it } from 'vitest';
import { acceptsPointerDown, appendInk, morphPath, toPadUnit } from './ink';

describe('acceptsPointerDown', () => {
	it('takes the primary pointer', () => {
		expect(acceptsPointerDown({ isPrimary: true, pointerType: 'touch', button: 0 })).toBe(true);
		expect(acceptsPointerDown({ isPrimary: true, pointerType: 'mouse', button: 0 })).toBe(true);
	});
	it('ignores a second touch (palm, extra finger)', () => {
		expect(acceptsPointerDown({ isPrimary: false, pointerType: 'touch', button: 0 })).toBe(false);
	});
	it('ignores non-main mouse buttons', () => {
		expect(acceptsPointerDown({ isPrimary: true, pointerType: 'mouse', button: 2 })).toBe(false);
	});
});

describe('toPadUnit', () => {
	it('maps client coordinates into the unit square', () => {
		expect(toPadUnit(150, 70, { left: 100, top: 20, width: 100, height: 100 })).toEqual({ x: 0.5, y: 0.5 });
	});
});

describe('appendInk', () => {
	it('skips an identical consecutive point', () => {
		const ink = [{ x: 0, y: 0 }];
		expect(appendInk(ink, { x: 0, y: 0 })).toBe(false);
		expect(appendInk(ink, { x: 1, y: 0 })).toBe(true);
		expect(ink).toHaveLength(2);
	});
});

describe('morphPath', () => {
	const a = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
	const b = [{ x: 0, y: 1 }, { x: 1, y: 1 }];
	it('starts at the ink and ends at the target', () => {
		expect(morphPath(a, b, 0)[0]).toEqual({ x: 0, y: 0 });
		const end = morphPath(a, b, 1);
		expect(end[0].y).toBeCloseTo(1);
		expect(end.at(-1)!.x).toBeCloseTo(1);
	});
	it('clamps t', () => {
		expect(morphPath(a, b, 5)[0].y).toBeCloseTo(1);
		expect(morphPath(a, b, -5)[0].y).toBeCloseTo(0);
	});
});
