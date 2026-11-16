import { describe, expect, it } from 'vitest';
import { partsHref, selectionFromParams, MAX_PARTS } from './url';

describe('selectionFromParams', () => {
	it('reads r, repeated p and s', () => {
		expect(selectionFromParams(new URLSearchParams('r=85&p=口&p=木&s=8'))).toEqual({ r: 85, p: ['口', '木'], s: 8 });
		expect(selectionFromParams(new URLSearchParams(''))).toEqual({ p: [] });
	});

	it('drops garbage: invalid r and s, empty, multi-code-point and duplicate parts, beyond the max', () => {
		expect(selectionFromParams(new URLSearchParams('r=0&s=-1'))).toEqual({ p: [] });
		expect(selectionFromParams(new URLSearchParams('r=215&s=99'))).toEqual({ p: [] });
		expect(selectionFromParams(new URLSearchParams('r=8.5&s=x'))).toEqual({ p: [] });
		expect(selectionFromParams(new URLSearchParams('r=1e2&s=0x8'))).toEqual({ p: [] });
		expect(selectionFromParams(new URLSearchParams('p=&p=口口&p=口&p=口&p=%F0%A0%80%80'))).toEqual({ p: ['口', '𠀀'] });
		const many = Array.from({ length: 12 }, (_, i) => `p=${String.fromCodePoint(0x4e00 + i)}`).join('&');
		expect(selectionFromParams(new URLSearchParams(many)).p).toHaveLength(MAX_PARTS);
		expect(MAX_PARTS).toBe(8);
	});
});

describe('partsHref', () => {
	it('builds a stable URL that round-trips', () => {
		const sel = { r: 85, p: ['口', '木'], s: 8 };
		const href = partsHref(sel);
		expect(href).toBe('/search/parts?r=85&p=%E5%8F%A3&p=%E6%9C%A8&s=8');
		expect(selectionFromParams(new URL(href, 'http://x').searchParams)).toEqual(sel);
		expect(partsHref({ p: [] })).toBe('/search/parts');
		expect(partsHref({ r: 149, p: [] })).toBe('/search/parts?r=149');
	});
});
