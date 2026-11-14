import { describe, expect, it } from 'vitest';
import { resultCountText } from './sourceResults';

describe('resultCountText', () => {
	it('counts the results when the server returned fewer than the limit', () => {
		expect(resultCountText(0, 0, 100)).toBe('0 results');
		expect(resultCountText(1, 1, 100)).toBe('1 result');
		expect(resultCountText(42, 99, 100)).toBe('42 results');
	});

	it('says the list is cut off when the server returned the limit', () => {
		expect(resultCountText(100, 100, 100)).toBe(
			'Showing the first 100 results — refine your search',
		);
		// Language-filtered: the shown count, still marked as cut off.
		expect(resultCountText(37, 100, 100)).toBe(
			'Showing the first 37 results — refine your search',
		);
	});
});
