import { IDENTITY_CLOCK } from '$lib/study/studyClock';
import { describe, expect, it } from 'vitest';

import type { CharRow } from '../api/types';
import { strongReviews } from '../testing/reviews';
import { DEFAULT_W } from './fsrs/params';
import { levelMastery } from './levelMastery';
import type { StudyCard } from './types';

const NOW = new Date('2027-06-01T00:00:00.000Z');

function card(id: string, written: string): StudyCard {
	return { id, kind: 'vocab', entryId: 1, written, deckIds: ['general'], createdAt: '2025-01-01T00:00:00Z' };
}

const row = (i: number, c: string, v?: string[]): CharRow => ({ i, c, ...(v ? { v } : {}) });
const rows = [row(1, '日'), row(2, '月'), row(3, '火'), row(4, '水'), row(5, '愛', ['爱'])];

const levels = [
	{ levelId: 1, name: 'N5', chars: new Set(['日', '月', '火']) },
	{ levelId: 2, name: 'N4', chars: new Set(['水', '愛']) },
	{ levelId: 3, name: 'N3', chars: new Set<string>() }
];

describe('levelMastery', () => {
	it('counts a character of a strong card as learned', () => {
		const result = levelMastery(levels, rows, [card('a', '日')], strongReviews('a'), NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.get('N5')).toEqual({ learned: 1, total: 3 });
	});

	it('counts a duplicate card on one glyph once and an empty level as 0 of 0', () => {
		const result = levelMastery(
			levels,
			rows,
			[card('a', '日日')],
			strongReviews('a'),
			NOW,
			DEFAULT_W
		, IDENTITY_CLOCK);
		expect(result.get('N5')).toEqual({ learned: 1, total: 3 });
		expect(result.get('N3')).toEqual({ learned: 0, total: 0 });
	});

	it('counts a variant-only studied character like the Stats map does', () => {
		const result = levelMastery(levels, rows, [card('a', '爱')], strongReviews('a'), NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.get('N4')).toEqual({ learned: 1, total: 2 });
	});

	it('does not count an unreviewed character', () => {
		const result = levelMastery(levels, rows, [card('a', '水')], [], NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(result.get('N4')).toEqual({ learned: 0, total: 2 });
	});
});
