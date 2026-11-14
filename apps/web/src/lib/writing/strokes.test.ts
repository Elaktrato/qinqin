import liaoRaw from '../../../node_modules/hanzi-writer-data/了.json?raw';
import { describe, expect, it } from 'vitest';
import { parseStrokeData, toUnit } from './strokes';

const real = JSON.parse(liaoRaw);

describe('toUnit', () => {
	it('maps stroke-data coordinates to unit coordinates, y down', () => {
		expect(toUnit([512, 388])).toEqual({ x: 0.5, y: 0.5 });
	});
});

describe('parseStrokeData', () => {
	it('parses real data', () => {
		const s = parseStrokeData('了', real);
		expect(s?.char).toBe('了');
		expect(s?.medians).toHaveLength(2);
		expect(s?.outlines).toHaveLength(2);
	});
	it('rejects malformed data', () => {
		expect(parseStrokeData('了', null)).toBeNull();
		expect(parseStrokeData('了', { strokes: ['M 0 0'] })).toBeNull();
		expect(parseStrokeData('了', { strokes: ['a', 'b'], medians: [[[1, 2]]] })).toBeNull();
		expect(parseStrokeData('了', { strokes: ['a'], medians: [[['x', 2]]] })).toBeNull();
		expect(parseStrokeData('了', { strokes: ['a'], medians: [[]] })).toBeNull();
	});
});
