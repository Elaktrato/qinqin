import { describe, expect, it } from 'vitest';
import { HEATMAP_DAYS, reviewCountsByDay } from './heatmap';

const NOW = new Date('2026-03-15T12:00:00Z');

function dayKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

describe('reviewCountsByDay', () => {
	it('counts review events per UTC day and excludes other event types', () => {
		const counts = reviewCountsByDay(
			[
				{ type: 'review', ts: '2026-03-15T09:00:00Z' },
				{ type: 'review', ts: '2026-03-15T23:59:59Z' },
				{ type: 'review', ts: '2026-03-14T00:00:00Z' },
				{ type: 'session', ts: '2026-03-15T10:00:00Z' },
				{ type: 'view', ts: '2026-03-15T11:00:00Z' },
				{ type: 'lookup', ts: '2026-03-14T12:00:00Z' }
			],
			NOW
		);

		expect(counts.get('2026-03-15')).toBe(2);
		expect(counts.get('2026-03-14')).toBe(1);
	});

	it('zero-fills sparse days across the 91-day window', () => {
		const counts = reviewCountsByDay(
			[{ type: 'review', ts: '2026-03-15T09:00:00Z' }, { type: 'review', ts: '2026-03-01T12:00:00Z' }],
			NOW
		);

		expect(counts.size).toBe(HEATMAP_DAYS);
		expect(counts.get('2026-03-15')).toBe(1);
		expect(counts.get('2026-03-01')).toBe(1);
		expect(counts.get('2026-03-10') ?? 0).toBe(0);
		expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(2);
	});

	it('uses UTC days, so a local offset resolves to its UTC date', () => {
		const counts = reviewCountsByDay([{ type: 'review', ts: '2026-03-15T01:30:00+09:00' }], NOW);

		// 2026-03-14T16:30Z, not the local 15th.
		expect(counts.get('2026-03-14')).toBe(1);
		expect(counts.get('2026-03-15') ?? 0).toBe(0);
	});

	it('covers exactly today and the previous 90 UTC days', () => {
		const counts = reviewCountsByDay([], NOW);

		const keys = [...counts.keys()];
		expect(keys[0]).toBe('2025-12-15');
		expect(keys[keys.length - 1]).toBe(dayKey(NOW));
		expect(new Set(keys).size).toBe(HEATMAP_DAYS);
	});

	it('counts the window edges and ignores events outside it', () => {
		const counts = reviewCountsByDay(
			[
				{ type: 'review', ts: '2025-12-15T00:00:00Z' }, // first day
				{ type: 'review', ts: '2026-03-15T23:59:59Z' }, // today
				{ type: 'review', ts: '2025-12-14T23:59:59Z' }, // the day before
				{ type: 'review', ts: '2026-03-16T00:00:00Z' }, // tomorrow
				{ type: 'review', ts: 'not a date' }
			],
			NOW
		);

		expect(counts.get('2025-12-15')).toBe(1);
		expect(counts.get('2026-03-15')).toBe(1);
		expect(counts.size).toBe(HEATMAP_DAYS);
		expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(2);
	});

	it('accepts a shorter custom window', () => {
		const counts = reviewCountsByDay(
			[{ type: 'review', ts: '2026-03-13T12:00:00Z' }, { type: 'review', ts: '2026-03-01T12:00:00Z' }],
			NOW,
			7
		);

		expect(counts.size).toBe(7);
		expect(counts.get('2026-03-13')).toBe(1);
		expect(counts.has('2026-03-01')).toBe(false);
	});
});
