import { describe, expect, it } from 'vitest';
import { studyDay, studyDayStats } from './studyDay';

describe('studyDay performance', () => {
	it('folds 100k instants over a year with few Intl calls', () => {
		const sd = studyDay([{ zone: 'Europe/Berlin', from: null }]);
		const start = Date.parse('2025-01-01T00:00:00Z');
		let seed = 84;
		const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
		const instants = Array.from({ length: 100_000 }, () => start + Math.floor(rand() * 365 * 86_400_000));
		studyDayStats.formatCalls = 0;
		const t0 = performance.now();
		const days = new Set<string>();
		for (const t of instants) days.add(sd.dayOf(t));
		const elapsed = performance.now() - t0;
		expect(days.size).toBeGreaterThanOrEqual(365);
		expect(days.size).toBeLessThanOrEqual(366);
		// Wall-clock is only a generous safety net; the call count is the real bound.
		expect(elapsed).toBeLessThan(10_000);
		expect(studyDayStats.formatCalls).toBeLessThan(1500);
	});
	it('sorted instants need no more calls', () => {
		const sd = studyDay([{ zone: 'America/New_York', from: null }]);
		const start = Date.parse('2025-01-01T00:00:00Z');
		studyDayStats.formatCalls = 0;
		for (let i = 0; i < 100_000; i++) sd.dayOf(start + i * 315_000);
		expect(studyDayStats.formatCalls).toBeLessThan(1500);
	});
});
