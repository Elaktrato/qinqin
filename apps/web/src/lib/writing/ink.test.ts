import { describe, expect, it } from 'vitest';
import { acceptsPointerDown, createPalmGate, appendInk, morphPath, toPadUnit } from './ink';

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

describe('createPalmGate', () => {
	const touch = { isPrimary: true, pointerType: 'touch', button: 0 };
	const pen = { isPrimary: true, pointerType: 'pen', button: 0 };
	it('accepts touch until a pen has been seen', () => {
		const gate = createPalmGate();
		expect(gate(touch)).toBe(true);
		expect(gate(pen)).toBe(true);
		expect(gate(touch)).toBe(false);
		expect(gate(pen)).toBe(true);
	});
	it('remembers a pen even when its own down was not primary', () => {
		const gate = createPalmGate();
		gate({ ...pen, isPrimary: false });
		expect(gate(touch)).toBe(false);
	});
	it('keeps the plain rules for mouse', () => {
		const gate = createPalmGate();
		expect(gate({ isPrimary: true, pointerType: 'mouse', button: 2 })).toBe(false);
	});
});

describe('toPadUnit', () => {
	it('maps client coordinates into the unit square', () => {
		expect(toPadUnit(150, 70, { left: 100, top: 20, width: 100, height: 100 })).toEqual({ x: 0.5, y: 0.5 });
	});
	it('gives null for a pad without size instead of Infinity or NaN', () => {
		expect(toPadUnit(150, 70, { left: 100, top: 20, width: 0, height: 100 })).toBeNull();
		expect(toPadUnit(150, 70, { left: 100, top: 20, width: 100, height: 0 })).toBeNull();
		expect(toPadUnit(NaN, 70, { left: 100, top: 20, width: 100, height: 100 })).toBeNull();
	});
});

describe('appendInk', () => {
	it('skips an identical consecutive point', () => {
		const ink = [{ x: 0, y: 0 }];
		expect(appendInk(ink, { x: 0, y: 0 })).toBe(false);
		expect(appendInk(ink, { x: 1, y: 0 })).toBe(true);
		expect(appendInk(ink, null)).toBe(false);
		expect(appendInk(ink, { x: Infinity, y: 0 })).toBe(false);
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
