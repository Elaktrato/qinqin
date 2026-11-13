import { describe, expect, it } from 'vitest';
import { ACTIVITY_SOURCES, activityByDay, dayTooltip, levelFor, readingPoints } from './activity';

const NOW = new Date('2026-11-13T12:00:00Z');

describe('readingPoints', () => {
	it.each([
		[{ seconds: NaN }, 0],
		[{ seconds: Infinity }, 0],
		[{ seconds: -10 }, 0],
		[{ seconds: 29 }, 0],
		[{ seconds: 30 }, 1],
		[{ seconds: 300 }, 1],
		[{ seconds: 301 }, 2],
		[{ seconds: 99999 }, 24],
		['nope', 0],
		[null, 0],
		[undefined, 0],
		[{ seconds: '60' }, 0],
		[{}, 0]
	])('%j -> %i', (payload, expected) => {
		expect(readingPoints(payload)).toBe(expected);
	});
});

describe('ACTIVITY_SOURCES', () => {
	it('defines review and read sources', () => {
		const review = ACTIVITY_SOURCES.find((s) => s.type === 'review');
		const read = ACTIVITY_SOURCES.find((s) => s.type === 'read');
		expect(review).toMatchObject({ label: 'Flashcard reviews', unit: 'review(s)' });
		expect(review?.points({})).toBe(1);
		expect(read).toMatchObject({ label: 'Reading', unit: 'min' });
		expect(read?.points({ seconds: 600 })).toBe(2);
	});
});

describe('activityByDay', () => {
	it('sums reviews and reads on the same day with bySource', () => {
		const map = activityByDay(
			[
				{ ts: '2026-11-13T01:00:00Z', type: 'review' },
				{ ts: '2026-11-13T02:00:00Z', type: 'review' },
				{ ts: '2026-11-13T03:00:00Z', type: 'read', payload: { seconds: 900 } }
			],
			NOW
		);
		expect(map.get('2026-11-13')).toEqual({
			day: '2026-11-13',
			total: 5,
			bySource: { review: 2, read: 3 }
		});
	});

	it('is dense over 91 days, oldest first', () => {
		const keys = [...activityByDay([], NOW).keys()];
		expect(keys).toHaveLength(91);
		expect(keys[0]).toBe('2026-08-15');
		expect(keys[90]).toBe('2026-11-13');
		expect(activityByDay([], NOW).get('2026-11-01')).toEqual({
			day: '2026-11-01',
			total: 0,
			bySource: {}
		});
	});

	it('buckets by UTC midnight', () => {
		const map = activityByDay(
			[
				{ ts: '2026-11-12T23:59:59Z', type: 'review' },
				{ ts: '2026-11-13T00:00:00Z', type: 'review' }
			],
			NOW
		);
		expect(map.get('2026-11-12')?.total).toBe(1);
		expect(map.get('2026-11-13')?.total).toBe(1);
	});

	it('ignores unknown types, bad ts, future days, out-of-window and zero-point reads', () => {
		const map = activityByDay(
			[
				{ ts: '2026-11-13T01:00:00Z', type: 'session' },
				{ ts: 'garbage', type: 'review' },
				{ ts: '2026-11-14T00:00:00Z', type: 'review' },
				{ ts: '2026-08-14T23:59:59Z', type: 'review' },
				{ ts: '2026-11-13T01:00:00Z', type: 'read', payload: { seconds: 5 } }
			],
			NOW
		);
		expect([...map.values()].reduce((sum, d) => sum + d.total, 0)).toBe(0);
		expect(map.get('2026-11-13')?.bySource).toEqual({});
	});

	it('supports a custom window', () => {
		expect(activityByDay([], NOW, 7).size).toBe(7);
	});
});

describe('dayTooltip', () => {
	const day = (total: number, bySource: Record<string, number>) => ({
		day: '2026-11-13',
		total,
		bySource
	});

	it('reports no activity for zero', () => {
		expect(dayTooltip(day(0, {}))).toBe('2026-11-13: no activity');
	});

	it('combines sources with reading minutes', () => {
		expect(dayTooltip(day(12, { review: 9, read: 3 }))).toBe(
			'2026-11-13: 12 points — 9 Flashcard reviews, 3 Reading (15 min)'
		);
	});

	it('uses singular forms', () => {
		expect(dayTooltip(day(1, { review: 1 }))).toBe('2026-11-13: 1 point — 1 Flashcard review');
	});

	it('handles reading only', () => {
		expect(dayTooltip(day(1, { read: 1 }))).toBe('2026-11-13: 1 point — 1 Reading (5 min)');
	});
});

describe('levelFor', () => {
	it.each([
		[-1, 0],
		[0, 0],
		[1, 1],
		[2, 2],
		[3, 2],
		[4, 3],
		[6, 3],
		[7, 4],
		[500, 4]
	])('count %i -> level %i', (count, level) => {
		expect(levelFor(count, 10)).toBe(level);
	});

	it('does not depend on max (the existing rule is absolute)', () => {
		expect(levelFor(5, 5)).toBe(levelFor(5, 500));
	});
});
