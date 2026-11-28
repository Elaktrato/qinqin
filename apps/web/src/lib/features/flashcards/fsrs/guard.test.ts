import { describe, expect, it } from 'vitest';

import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { activeProblem, sameWeights, shouldRestorePointer } from './guard';

describe('sameWeights', () => {
	it('compares the numbers, not the array', () => {
		expect(sameWeights(DEFAULT_W, [...DEFAULT_W])).toBe(true);
		const w = [...DEFAULT_W];
		w[8] += 0.01;
		expect(sameWeights(DEFAULT_W, w)).toBe(false);
	});
});

describe('shouldRestorePointer', () => {
	it('restores only while the pointer is still what this page set', () => {
		expect(shouldRestorePointer('B', 'B')).toBe(true);
		expect(shouldRestorePointer(null, null)).toBe(true);
		expect(shouldRestorePointer('C', 'B')).toBe(false);
		expect(shouldRestorePointer(null, 'B')).toBe(false);
	});
});

describe('activeProblem', () => {
	it('says so when the pointer names a set that cannot be read', () => {
		expect(activeProblem({ sets: [], active: null, w: DEFAULT_W, pointer: 'GONE' })).toMatch(
			/could not be read/
		);
	});

	it('is silent for defaults and for a readable set', () => {
		expect(activeProblem({ sets: [], active: null, w: DEFAULT_W, pointer: null })).toBeNull();
		expect(activeProblem({ sets: [], active: null, w: DEFAULT_W })).toBeNull();
		const set = { id: 'A', w: [...DEFAULT_W], createdAt: 'x', source: 'imported' as const };
		expect(activeProblem({ sets: [set], active: set, w: set.w, pointer: 'A' })).toBeNull();
	});
});
