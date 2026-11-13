import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, PopupStack } from './popupStack.svelte';

const base = { anchor: { x: 0, y: 0, w: 1, h: 1 }, text: 't', offset: 0, results: null };

describe('PopupStack wrapper', () => {
	it('opens, nests, and replaces siblings via the core', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		const b = s.open(base, a)!;
		s.open(base, b);
		const c = s.open(base, a)!;
		expect(s.frames.map((f) => f.id)).toEqual([a, c]);
		expect(s.frames.map((f) => f.depth)).toEqual([1, 2]);
	});

	it('returns null at MAX_DEPTH and for unknown/closed parents, leaving frames identical', () => {
		const s = new PopupStack();
		let id = s.open(base)!;
		for (let i = 1; i < MAX_DEPTH; i++) id = s.open(base, id)!;
		const full = s.frames;
		expect(s.open(base, id)).toBeNull();
		expect(s.open(base, 999)).toBeNull();
		expect(s.frames).toBe(full);
		s.closeTop();
		const after = s.frames;
		expect(s.open(base, id)).toBeNull();
		expect(s.frames).toBe(after);
	});

	it('keeps ids unique across closeAll and ignores updates to closed frames', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		s.closeAll();
		const b = s.open(base)!;
		expect(b).not.toBe(a);
		const before = s.frames;
		s.update(a, { results: [] });
		expect(s.frames).toBe(before);
		s.update(b, { error: 'e' });
		expect(s.frames[0].error).toBe('e');
	});

	it('closeTop and closeAbove delegate', () => {
		const s = new PopupStack();
		const a = s.open(base)!;
		const b = s.open(base, a)!;
		s.open(base, b);
		s.closeAbove(a);
		expect(s.frames.map((f) => f.id)).toEqual([a]);
		s.closeTop();
		expect(s.frames).toEqual([]);
	});
});
