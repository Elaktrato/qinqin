import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateByDay, HEATMAP_DAYS } from './aggregate';

const NOW = new Date('2026-03-15T12:00:00Z');

function dayKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

describe('aggregateByDay', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('counts events per UTC day', () => {
		const counts = aggregateByDay(
			[
				{ ts: '2026-03-15T09:00:00Z' },
				{ ts: '2026-03-15T23:59:59Z' },
				{ ts: '2026-03-14T00:00:00Z' }
			],
			NOW
		);

		expect(counts.get('2026-03-15')).toBe(2);
		expect(counts.get('2026-03-14')).toBe(1);
	});

	it('keys sparse days, zero-filling the rest of the 91-day window', () => {
		const counts = aggregateByDay(
			[{ ts: '2026-03-15T09:00:00Z' }, { ts: '2026-03-01T12:00:00Z' }],
			NOW
		);

		// 13 weeks of cells, every day present: the grid can render
		// zeros without filling gaps itself.
		expect(counts.size).toBe(HEATMAP_DAYS);
		expect(counts.get('2026-03-15')).toBe(1);
		expect(counts.get('2026-03-01')).toBe(1);
		expect(counts.get('2026-03-10') ?? 0).toBe(0);
		expect([...counts.values()].reduce((sum, n) => sum + n, 0)).toBe(2);
	});

	it('covers exactly today and the previous 90 UTC days', () => {
		const counts = aggregateByDay([], NOW);

		const keys = [...counts.keys()];
		expect(keys[0]).toBe('2025-12-15');
		expect(keys[keys.length - 1]).toBe(dayKey(NOW));
		expect(new Set(keys).size).toBe(HEATMAP_DAYS);
	});

	it('uses UTC days, so offsets resolve to their UTC date', () => {
		const counts = aggregateByDay([{ ts: '2026-03-15T01:30:00+09:00' }], NOW);

		// 2026-03-14T16:30Z, not the local 15th.
		expect(counts.get('2026-03-14')).toBe(1);
		expect(counts.get('2026-03-15') ?? 0).toBe(0);
	});

	it('ignores events before the window, after today, and with bad timestamps', () => {
		const counts = aggregateByDay(
			[
				{ ts: '2025-12-14T23:59:59Z' }, // the day before the window
				{ ts: '2026-03-16T00:00:00Z' }, // tomorrow
				{ ts: 'not a date' }
			],
			NOW
		);

		expect(counts.size).toBe(HEATMAP_DAYS);
		expect([...counts.values()].every((count) => count === 0)).toBe(true);
	});

	it('counts an event on the first day of the window', () => {
		const counts = aggregateByDay([{ ts: '2025-12-15T00:00:00Z' }], NOW);

		expect(counts.get('2025-12-15')).toBe(1);
	});
});
