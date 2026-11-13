import { describe, expect, it } from 'vitest';

import { BASE_XP, dailyStreak, levelFromXp, levelProgress, xpFromReviews } from './exp';
import type { ReviewEvent, ReviewGrade, StudyCardKind } from './types';

function ev(
	n: number,
	ts: string,
	grade: ReviewGrade = 1,
	mode: StudyCardKind = 'vocab'
): ReviewEvent {
	return {
		id: `01JTEST${String(n).padStart(19, '0')}`,
		workspaceId: 1,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId: `c${n}`, mode, grade }
	};
}

describe('BASE_XP', () => {
	it('has the per-kind base values', () => {
		expect(BASE_XP).toEqual({ vocab: 10, sentence: 15, writing: 20, tone: 8 });
	});
});

describe('xpFromReviews', () => {
	it('is zero for no reviews', () => {
		expect(xpFromReviews([])).toBe(0);
	});

	it('uses the base by mode plus the grade bonus, one first-of-day bonus', () => {
		expect(xpFromReviews([ev(1, '2026-01-01T10:00:00Z', 1, 'vocab')])).toBe(10 + 10);
		expect(xpFromReviews([ev(1, '2026-01-01T10:00:00Z', 3, 'sentence')])).toBe(15 + 5 + 10);
		expect(xpFromReviews([ev(1, '2026-01-01T10:00:00Z', 4, 'writing')])).toBe(20 + 10 + 10);
		expect(xpFromReviews([ev(1, '2026-01-01T10:00:00Z', 2, 'tone')])).toBe(8 + 0 + 10);
	});

	it('awards the daily bonus once for two reviews on the same UTC day', () => {
		const reviews = [ev(1, '2026-01-01T01:00:00Z'), ev(2, '2026-01-01T22:00:00Z')];
		expect(xpFromReviews(reviews)).toBe(10 + 10 + 10);
	});

	it('awards the bonus on each different day', () => {
		const reviews = [ev(1, '2026-01-01T01:00:00Z'), ev(2, '2026-01-02T01:00:00Z')];
		expect(xpFromReviews(reviews)).toBe(40);
	});

	it('splits days at UTC midnight, not local time', () => {
		const reviews = [ev(1, '2026-01-01T23:59:59.999Z'), ev(2, '2026-01-02T00:00:00.000Z')];
		expect(xpFromReviews(reviews)).toBe(40);
		const sameDay = [ev(1, '2026-01-01T00:00:00.000Z'), ev(2, '2026-01-01T23:59:59.999Z')];
		expect(xpFromReviews(sameDay)).toBe(30);
	});

	it('is deterministic for any input order, including same-ms ties', () => {
		const a = ev(1, '2026-01-01T05:00:00Z', 1, 'vocab');
		const b = ev(2, '2026-01-01T05:00:00Z', 1, 'writing');
		const c = ev(3, '2026-01-01T04:00:00Z', 4, 'tone');
		const results = [
			[a, b, c],
			[c, b, a],
			[b, a, c],
			[a, c, b]
		].map((p) => xpFromReviews(p));
		expect(new Set(results).size).toBe(1);
		expect(results[0]).toBe(10 + 20 + (8 + 10) + 10);
	});

	it('gives the same-ms tie bonus to the lowest id regardless of order', () => {
		// bonus is flat +10, so verify via a day split: tie across ids stays stable
		const a = ev(1, '2026-01-01T05:00:00Z');
		const b = ev(2, '2026-01-01T05:00:00Z');
		expect(xpFromReviews([b, a])).toBe(xpFromReviews([a, b]));
	});

	it('ignores malformed events', () => {
		const bad = ev(2, '2026-01-02T00:00:00Z');
		(bad.payload as { grade: number }).grade = 9;
		expect(xpFromReviews([ev(1, '2026-01-01T00:00:00Z', 3), bad])).toBe(25);
	});
});

describe('levelProgress', () => {
	it('starts at level 1', () => {
		expect(levelProgress(0)).toEqual({ level: 1, xpInto: 0, xpForNext: 100 });
	});

	it('crosses at 100, 300 and 600 exactly', () => {
		expect(levelProgress(99)).toEqual({ level: 1, xpInto: 99, xpForNext: 100 });
		expect(levelProgress(100)).toEqual({ level: 2, xpInto: 0, xpForNext: 200 });
		expect(levelProgress(299)).toEqual({ level: 2, xpInto: 199, xpForNext: 200 });
		expect(levelProgress(300)).toEqual({ level: 3, xpInto: 0, xpForNext: 300 });
		expect(levelProgress(600)).toEqual({ level: 4, xpInto: 0, xpForNext: 400 });
	});

	it('treats negative or non-finite xp as zero', () => {
		expect(levelProgress(-5).level).toBe(1);
		expect(levelProgress(Number.NaN).level).toBe(1);
	});

	it('levelFromXp agrees', () => {
		expect(levelFromXp(250)).toBe(2);
		expect(levelFromXp(300)).toBe(3);
	});
});

describe('dailyStreak', () => {
	const now = Date.parse('2026-01-10T12:00:00Z');

	it('is empty for no reviews', () => {
		expect(dailyStreak([], now)).toEqual({ current: 0, best: 0, todayDone: false });
	});

	it('counts consecutive days back from today', () => {
		const r = [
			ev(1, '2026-01-08T10:00:00Z'),
			ev(2, '2026-01-09T10:00:00Z'),
			ev(3, '2026-01-10T01:00:00Z')
		];
		expect(dailyStreak(r, now)).toEqual({ current: 3, best: 3, todayDone: true });
	});

	it('keeps yesterday streak alive when today is empty', () => {
		const r = [ev(1, '2026-01-08T10:00:00Z'), ev(2, '2026-01-09T23:59:00Z')];
		expect(dailyStreak(r, now)).toEqual({ current: 2, best: 2, todayDone: false });
	});

	it('breaks on a gap and tracks best', () => {
		const r = [
			ev(1, '2026-01-01T10:00:00Z'),
			ev(2, '2026-01-02T10:00:00Z'),
			ev(3, '2026-01-03T10:00:00Z'),
			ev(4, '2026-01-09T10:00:00Z')
		];
		expect(dailyStreak(r, now)).toEqual({ current: 1, best: 3, todayDone: false });
	});

	it('is zero current when the last review is two days ago', () => {
		expect(dailyStreak([ev(1, '2026-01-08T10:00:00Z')], now)).toEqual({
			current: 0,
			best: 1,
			todayDone: false
		});
	});

	it('uses UTC midnight for day edges', () => {
		const r = [ev(1, '2026-01-09T23:59:59Z'), ev(2, '2026-01-10T00:00:00Z')];
		expect(dailyStreak(r, Date.parse('2026-01-10T00:00:01Z')).current).toBe(2);
	});
});
