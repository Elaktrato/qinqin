import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, PopupStack } from './popupStack';

const base = { anchor: { x: 0, y: 0, w: 1, h: 1 }, text: 't', offset: 0, results: null };

describe('PopupStack', () => {
	it('opens a depth-1 root frame and replaces the stack without parent', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		s.open(base, a);
		const b = s.open(base)!;
		expect(s.frames.map((f) => f.id)).toEqual([b]);
		expect(s.frames[0].depth).toBe(1);
	});

	it('assigns depth = parent.depth + 1', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		const b = s.open(base, a)!;
		s.open(base, b);
		expect(s.frames.map((f) => f.depth)).toEqual([1, 2, 3]);
	});

	it('returns null at MAX_DEPTH and leaves frames unchanged', () => {
		const s = new PopupStack();
		let id = s.open(base)!;
		for (let i = 1; i < MAX_DEPTH; i++) id = s.open(base, id)!;
		const before = s.frames;
		expect(s.open(base, id)).toBeNull();
		expect(s.frames).toBe(before);
		expect(s.frames).toHaveLength(MAX_DEPTH);
	});

	it('opening a sibling replaces the old child chain', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		const b = s.open(base, a)!;
		s.open(base, b);
		const c = s.open(base, a)!;
		expect(s.frames.map((f) => f.id)).toEqual([a, c]);
	});

	it('a sibling at the deepest allowed level replaces the existing frame', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		const b = s.open(base, a)!;
		const c = s.open(base, b)!;
		s.open(base, c);
		const d = s.open(base, c)!;
		expect(d).not.toBeNull();
		expect(s.frames).toHaveLength(MAX_DEPTH);
		expect(s.frames[MAX_DEPTH - 1].id).toBe(d);
	});

	it('closeAbove removes deeper frames only', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		const b = s.open(base, a)!;
		s.open(base, b);
		s.closeAbove(a);
		expect(s.frames.map((f) => f.id)).toEqual([a]);
		s.closeAbove(999);
		expect(s.frames.map((f) => f.id)).toEqual([a]);
	});

	it('closeTop removes the deepest frame first', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		s.open(base, a);
		s.closeTop();
		expect(s.frames.map((f) => f.id)).toEqual([a]);
		s.closeTop();
		s.closeTop();
		expect(s.frames).toEqual([]);
	});

	it('never reuses ids', () => {
		const s = new PopupStack();
		const seen = new Set<number>();
		for (let i = 0; i < 5; i++) {
			const a = s.open(base)!;
			const b = s.open(base, a)!;
			s.closeTop();
			s.closeAll();
			for (const id of [a, b]) {
				expect(seen.has(id)).toBe(false);
				seen.add(id);
			}
		}
	});

	it('update sets results/error on an open frame', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		s.update(a, { results: [], error: 'x' });
		expect(s.frames[0].results).toEqual([]);
		expect(s.frames[0].error).toBe('x');
	});

	it('update on a closed frame is a no-op', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		s.closeAll();
		const b = s.open(base)!;
		const before = s.frames;
		s.update(a, { results: [] });
		expect(s.frames).toBe(before);
		expect(s.frames[0].id).toBe(b);
		expect(s.frames[0].results).toBeNull();
	});

	it('closeAll empties the stack', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		s.open(base, a);
		s.closeAll();
		expect(s.frames).toEqual([]);
	});

	it('replaces the frames array immutably on change', () => {
		const s = new PopupStack();
		const e = s.frames;
		const a = s.open(base)!;
		const one = s.frames;
		expect(one).not.toBe(e);
		s.update(a, { results: [] });
		expect(s.frames).not.toBe(one);
		expect(one[0].results).toBeNull();
	});
});
