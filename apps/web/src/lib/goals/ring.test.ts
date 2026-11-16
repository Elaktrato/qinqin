import { describe, expect, it } from 'vitest';
import { ringArc } from './ring';

describe('ringArc', () => {
	const c = 2 * Math.PI * 20;
	it('maps the fraction to a dash offset', () => {
		expect(ringArc(0, 20)).toEqual({ circumference: c, dashOffset: c });
		expect(ringArc(0.5, 20).dashOffset).toBeCloseTo(c / 2);
		expect(ringArc(1, 20)).toEqual({ circumference: c, dashOffset: 0 });
	});
	it('caps above 1 and treats NaN and negatives as empty', () => {
		expect(ringArc(1.4, 20).dashOffset).toBe(0);
		expect(ringArc(Number.NaN, 20).dashOffset).toBe(c);
		expect(ringArc(-0.5, 20).dashOffset).toBe(c);
	});
});
