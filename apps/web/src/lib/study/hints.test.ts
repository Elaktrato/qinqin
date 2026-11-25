import { describe, expect, it } from 'vitest';

import {
	HINT_REGISTRY,
	hintPatch,
	hintsForEntry,
	nextHint,
	readHintSettings,
	visibleHints,
	type HintPlan
} from './hints';

const plan: HintPlan = { always: ['reading'], onRequest: ['picture'] };

describe('the hint registry', () => {
	it('keeps one definition per kind in the fixed order', () => {
		expect(HINT_REGISTRY.map((d) => d.id)).toEqual(['reading', 'picture']);
	});

	it('picture is defined but has no source yet', () => {
		const picture = HINT_REGISTRY.find((d) => d.id === 'picture');
		expect(picture?.available({ hasReading: true, hasPicture: false })).toBe(false);
		expect(picture?.ready).toBe(false);
	});
});

describe('hintsForEntry', () => {
	it('reads what an entry offers', () => {
		expect(hintsForEntry({ readings: [{ type: 'pinyin', value: 'ma1' }] })).toEqual({
			hasReading: true,
			hasPicture: false
		});
		expect(hintsForEntry({ readings: [] })).toEqual({ hasReading: false, hasPicture: false });
	});
});

describe('revealing one hint at a time', () => {
	const two: HintPlan = { always: [], onRequest: ['reading', 'picture'] };

	it('shows nothing until asked, then one more each time, in order', () => {
		expect(visibleHints(two, 0)).toEqual([]);
		expect(visibleHints(two, 1)).toEqual(['reading']);
		expect(visibleHints(two, 2)).toEqual(['reading', 'picture']);
		expect(visibleHints(two, 9)).toEqual(['reading', 'picture']);
	});

	it('always-shown hints come first and are not counted', () => {
		expect(visibleHints(plan, 0)).toEqual(['reading']);
	});

	it('names the next hint or null when none is left', () => {
		expect(nextHint(two, 0)).toBe('reading');
		expect(nextHint(two, 1)).toBe('picture');
		expect(nextHint(two, 2)).toBeNull();
	});
});

describe('hintPatch', () => {
	it('is a merge patch for one cell', () => {
		expect(hintPatch('reading', 'vocab', 'always')).toEqual({ hints: { reading: { vocab: 'always' } } });
	});

	it('round-trips through readHintSettings', () => {
		const settings = hintPatch('picture', 'cloze', 'hint');
		expect(readHintSettings(settings).picture.cloze).toBe('hint');
	});
});
