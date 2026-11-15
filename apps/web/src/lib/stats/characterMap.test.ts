import { describe, expect, it } from 'vitest';

import { DEFAULT_W } from '$lib/study/fsrs/params';
import type { CharRow } from '$lib/api/types';
import type { ReviewEvent, ReviewGrade, StudyCard } from '$lib/study/types';
import { characterSummary } from './characterMap';

const NOW = new Date('2026-11-14T12:00:00.000Z');

function row(i: number, c: string, v?: string[]): CharRow {
	return v === undefined ? { i, c } : { i, c, v };
}

function card(id: string, written?: string): StudyCard {
	const base: StudyCard = { id, kind: 'vocab', entryId: 1, deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' };
	return written === undefined ? base : { ...base, written };
}

let seq = 0;
function review(cardId: string, grade: ReviewGrade, ts: string): ReviewEvent {
	seq += 1;
	return {
		id: `01JTEST${String(seq).padStart(19, '0')}`,
		workspaceId: 1,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	};
}

// A long run of Easy reviews: a year-class stability, so the score is learned.
function strongHistory(cardId: string): ReviewEvent[] {
	const days = ['2025-01-01', '2025-01-05', '2025-02-01', '2025-05-01', '2025-11-01', '2026-10-01'];
	return days.map((day) => review(cardId, 4, `${day}T00:00:00.000Z`));
}

describe('characterSummary', () => {
	it('is all unknown and empty without characters or reviews', () => {
		expect(characterSummary([], [], [], NOW, DEFAULT_W)).toEqual({
			total: 0,
			learned: 0,
			byStage: { unknown: 0, fresh: 0, learning: 0, mature: 0, learned: 0 }
		});
		const stats = characterSummary([row(1, '好'), row(2, '人')], [card('a', '好人')], [], NOW, DEFAULT_W);
		expect(stats.total).toBe(2);
		expect(stats.byStage.unknown).toBe(2);
		expect(stats.learned).toBe(0);
	});

	it('scores the characters a reviewed card contains', () => {
		const chars = [row(1, '好'), row(2, '人'), row(3, '大')];
		const cards = [card('strong', '好人'), card('weak', '大')];
		const reviews = [...strongHistory('strong'), review('weak', 1, '2026-11-14T10:00:00.000Z')];
		const stats = characterSummary(chars, cards, reviews, NOW, DEFAULT_W);
		expect(stats.total).toBe(3);
		expect(stats.learned).toBe(2);
		expect(stats.byStage.learned).toBe(2);
		expect(stats.byStage.unknown + stats.byStage.fresh).toBe(1);
	});

	it('lets a variant form light its cell (the map rule)', () => {
		const chars = [row(1, '爱', ['愛'])];
		const stats = characterSummary(chars, [card('t', '愛')], strongHistory('t'), NOW, DEFAULT_W);
		expect(stats.learned).toBe(1);
	});

	it('ignores cards without a written snapshot', () => {
		const stats = characterSummary([row(1, '好')], [card('legacy')], strongHistory('legacy'), NOW, DEFAULT_W);
		expect(stats.byStage.unknown).toBe(1);
	});
});
