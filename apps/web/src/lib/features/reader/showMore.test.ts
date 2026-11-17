import { describe, expect, it } from 'vitest';
import { ENTRIES_VISIBLE, SENSES_VISIBLE, visibleCount } from './showMore';

describe('visibleCount', () => {
	it('shows the first step of a longer list', () => {
		expect(visibleCount(10, 0, ENTRIES_VISIBLE)).toBe(3);
		expect(visibleCount(10, 0, SENSES_VISIBLE)).toBe(3);
	});

	it('never shows more than there are', () => {
		expect(visibleCount(2, 0, 3)).toBe(2);
		expect(visibleCount(0, 0, 3)).toBe(0);
		expect(visibleCount(5, 9, 3)).toBe(5);
	});

	it('adds a step to what is shown', () => {
		expect(visibleCount(10, 3, 3)).toBe(6);
		expect(visibleCount(10, 9, 3)).toBe(10);
	});

	it('shows everything without a step', () => {
		expect(visibleCount(30, 3)).toBe(30);
	});

	it('treats a negative shown count as nothing shown', () => {
		expect(visibleCount(10, -4, 3)).toBe(3);
	});
});
