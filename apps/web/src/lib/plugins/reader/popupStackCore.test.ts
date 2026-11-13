import { describe, expect, it } from 'vitest';
import {
	MAX_DEPTH,
	closeAbove,
	closeAll,
	closeTop,
	openFrame,
	updateFrame,
	type PopupFrame
} from './popupStackCore';

const base = { anchor: { x: 0, y: 0, w: 1, h: 1 }, text: 't', offset: 0, results: null };

/** Opens via the core, threading frames and the id counter like a caller would. */
function harness() {
	let frames: PopupFrame[] = [];
	let nextId = 1;
	return {
		get frames() {
			return frames;
		},
		open(parentId?: number): number | null {
			const r = openFrame(frames, nextId, base, parentId);
			if (!r) return null;
			frames = r.frames;
			nextId = r.nextId;
			return r.id;
		},
		set(f: PopupFrame[]) {
			frames = f;
		}
	};
}

describe('openFrame', () => {
	it('opens a depth-1 root frame and replaces the stack without parent', () => {
		const h = harness();
		const a = h.open()!;
		h.open(a);
		const b = h.open()!;
		expect(h.frames.map((f) => f.id)).toEqual([b]);
		expect(h.frames[0].depth).toBe(1);
	});

	it('assigns depth = parent.depth + 1', () => {
		const h = harness();
		const a = h.open()!;
		const b = h.open(a)!;
		h.open(b);
		expect(h.frames.map((f) => f.depth)).toEqual([1, 2, 3]);
	});

	it('returns null at MAX_DEPTH and leaves frames unchanged', () => {
		const h = harness();
		let id = h.open()!;
		for (let i = 1; i < MAX_DEPTH; i++) id = h.open(id)!;
		const before = h.frames;
		expect(openFrame(before, 99, base, id)).toBeNull();
		expect(h.frames).toBe(before);
		expect(h.frames).toHaveLength(MAX_DEPTH);
	});

	it('opening a sibling replaces the old child chain', () => {
		const h = harness();
		const a = h.open()!;
		const b = h.open(a)!;
		h.open(b);
		const c = h.open(a)!;
		expect(h.frames.map((f) => f.id)).toEqual([a, c]);
	});

	it('a sibling at the deepest allowed level replaces the existing frame', () => {
		const h = harness();
		const a = h.open()!;
		const b = h.open(a)!;
		const c = h.open(b)!;
		h.open(c);
		const d = h.open(c)!;
		expect(d).not.toBeNull();
		expect(h.frames).toHaveLength(MAX_DEPTH);
		expect(h.frames[MAX_DEPTH - 1].id).toBe(d);
	});

	it('returns null for an unknown parent and does not touch frames', () => {
		const h = harness();
		h.open();
		const before = h.frames;
		expect(openFrame(before, 99, base, 999)).toBeNull();
		expect(h.frames).toBe(before);
	});

	it('returns null for an already-closed parent', () => {
		const h = harness();
		const a = h.open()!;
		const b = h.open(a)!;
		h.set(closeTop(h.frames));
		const before = h.frames;
		expect(openFrame(before, 99, base, b)).toBeNull();
		expect(h.frames).toBe(before);
	});

	it('hands out unique, increasing ids that are never reused after closes', () => {
		const h = harness();
		const seen: number[] = [];
		for (let i = 0; i < 5; i++) {
			const a = h.open()!;
			const b = h.open(a)!;
			h.set(closeTop(h.frames));
			h.set(closeAll());
			seen.push(a, b);
		}
		expect(new Set(seen).size).toBe(seen.length);
		expect([...seen].sort((x, y) => x - y)).toEqual(seen);
	});

	it('does not alias the caller frame object', () => {
		const input = { ...base, anchor: { ...base.anchor }, text: 'orig' };
		const r = openFrame([], 1, input)!;
		input.text = 'changed';
		input.anchor.x = 50;
		expect(r.frames[0].text).toBe('orig');
		expect(r.frames[0].anchor.x).toBe(0);
	});
});

describe('closeAbove / closeTop / closeAll', () => {
	function three() {
		const h = harness();
		const a = h.open()!;
		const b = h.open(a)!;
		const c = h.open(b)!;
		return { h, a, b, c };
	}

	it('closeAbove removes deeper frames only', () => {
		const { h, a } = three();
		expect(closeAbove(h.frames, a).map((f) => f.id)).toEqual([a]);
	});

	it('closeAbove on the top frame or an unknown id returns the same array', () => {
		const { h, c } = three();
		expect(closeAbove(h.frames, c)).toBe(h.frames);
		expect(closeAbove(h.frames, 999)).toBe(h.frames);
	});

	it('closeTop removes the deepest frame first', () => {
		const { h, a, b } = three();
		const one = closeTop(h.frames);
		expect(one.map((f) => f.id)).toEqual([a, b]);
		expect(closeTop(closeTop(one))).toEqual([]);
	});

	it('closeTop on an empty stack returns the same array', () => {
		const empty: PopupFrame[] = [];
		expect(closeTop(empty)).toBe(empty);
	});

	it('closeAll returns an empty array', () => {
		expect(closeAll()).toEqual([]);
	});
});

describe('updateFrame', () => {
	it('sets results/error on an open frame without modifying handed-out objects', () => {
		const h = harness();
		const a = h.open()!;
		const before = h.frames;
		const next = updateFrame(before, a, { results: [], error: 'x' });
		expect(next[0].results).toEqual([]);
		expect(next[0].error).toBe('x');
		expect(next).not.toBe(before);
		expect(before[0].results).toBeNull();
		expect(before[0].error).toBeUndefined();
	});

	it('is a no-op (same array) for a closed frame', () => {
		const h = harness();
		const a = h.open()!;
		h.set(closeAll());
		h.open();
		const before = h.frames;
		expect(updateFrame(before, a, { results: [] })).toBe(before);
	});

	it('moves an open frame to a new anchor (re-anchoring after a scroll)', () => {
		const h = harness();
		const a = h.open()!;
		const before = h.frames;
		const anchor = { x: 5, y: 6, w: 7, h: 8 };
		const next = updateFrame(before, a, { anchor });
		expect(next[0].anchor).toEqual(anchor);
		expect(next[0].anchor).not.toBe(anchor);
		expect(before[0].anchor).not.toEqual(anchor);
	});
});
