import { describe, expect, it } from 'vitest';

import { BASE_XP, dailyStreak, levelFromXp, levelProgress, xpByKind, xpFromReviews } from './exp';
import streakFixture from '../../../../../docs/contracts/scheduler/streak.json';
import { studyDay } from '../time/studyDay';
import type { ReviewEvent, ReviewGrade, StudyCardKind } from './types';

const UTC = studyDay([]);
const TOKYO = studyDay([{ zone: 'Asia/Tokyo', from: null }]);

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
		expect(BASE_XP).toEqual({ vocab: 10, sentence: 15, writing: 20, tone: 8, reverse: 10, cloze: 15 });
	});
});

describe('xpFromReviews', () => {
	it('is zero for no reviews', () => {
		expect(xpFromReviews([], UTC.dayOf)).toBe(0);
	});

	it('uses the base by mode plus the grade bonus, one first-of-day bonus', () => {
		expect(xpFromReviews([ev(1, '2026-01-01T10:00:00Z', 1, 'vocab')], UTC.dayOf)).toBe(10 + 10);
		expect(xpFromReviews([ev(1, '2026-01-01T10:00:00Z', 3, 'sentence')], UTC.dayOf)).toBe(15 + 5 + 10);
		expect(xpFromReviews([ev(1, '2026-01-01T10:00:00Z', 4, 'writing')], UTC.dayOf)).toBe(20 + 10 + 10);
		expect(xpFromReviews([ev(1, '2026-01-01T10:00:00Z', 2, 'tone')], UTC.dayOf)).toBe(8 + 0 + 10);
	});

	it('awards the daily bonus once for two reviews on the same UTC day', () => {
		const reviews = [ev(1, '2026-01-01T01:00:00Z'), ev(2, '2026-01-01T22:00:00Z')];
		expect(xpFromReviews(reviews, UTC.dayOf)).toBe(10 + 10 + 10);
	});

	it('awards the bonus on each different day', () => {
		const reviews = [ev(1, '2026-01-01T01:00:00Z'), ev(2, '2026-01-02T01:00:00Z')];
		expect(xpFromReviews(reviews, UTC.dayOf)).toBe(40);
	});

	it('splits days at UTC midnight, not local time', () => {
		const reviews = [ev(1, '2026-01-01T23:59:59.999Z'), ev(2, '2026-01-02T00:00:00.000Z')];
		expect(xpFromReviews(reviews, UTC.dayOf)).toBe(40);
		const sameDay = [ev(1, '2026-01-01T00:00:00.000Z'), ev(2, '2026-01-01T23:59:59.999Z')];
		expect(xpFromReviews(sameDay, UTC.dayOf)).toBe(30);
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
		].map((p) => xpFromReviews(p, UTC.dayOf));
		expect(new Set(results).size).toBe(1);
		expect(results[0]).toBe(10 + 20 + (8 + 10) + 10);
	});

	it('ignores malformed events', () => {
		const bad = ev(2, '2026-01-02T00:00:00Z');
		(bad.payload as { grade: number }).grade = 9;
		expect(xpFromReviews([ev(1, '2026-01-01T00:00:00Z', 3), bad], UTC.dayOf)).toBe(25);
	});
});

describe('xpByKind', () => {
	it('splits base and grade xp by kind and leaves out the daily bonus', () => {
		const r = [
			ev(1, '2026-01-01T00:00:00Z', 4, 'vocab'),
			ev(2, '2026-01-02T00:00:00Z', 3, 'writing'),
			ev(3, '2026-01-02T01:00:00Z', 1, 'writing')
		];
		const by = xpByKind(r);
		expect(by).toEqual({ vocab: 20, sentence: 0, writing: 45, tone: 0, reverse: 0, cloze: 0 });
		expect(xpFromReviews(r, UTC.dayOf) - (by.vocab + by.sentence + by.writing + by.tone)).toBe(20);
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
		expect(dailyStreak([], now, UTC)).toEqual({ current: 0, best: 0, todayDone: false });
	});

	it('counts consecutive days back from today', () => {
		const r = [
			ev(1, '2026-01-08T10:00:00Z'),
			ev(2, '2026-01-09T10:00:00Z'),
			ev(3, '2026-01-10T01:00:00Z')
		];
		expect(dailyStreak(r, now, UTC)).toEqual({ current: 3, best: 3, todayDone: true });
	});

	it('keeps yesterday streak alive when today is empty', () => {
		const r = [ev(1, '2026-01-08T10:00:00Z'), ev(2, '2026-01-09T23:59:00Z')];
		expect(dailyStreak(r, now, UTC)).toEqual({ current: 2, best: 2, todayDone: false });
	});

	it('breaks on a gap and tracks best', () => {
		const r = [
			ev(1, '2026-01-01T10:00:00Z'),
			ev(2, '2026-01-02T10:00:00Z'),
			ev(3, '2026-01-03T10:00:00Z'),
			ev(4, '2026-01-09T10:00:00Z')
		];
		expect(dailyStreak(r, now, UTC)).toEqual({ current: 1, best: 3, todayDone: false });
	});

	it('is zero current when the last review is two days ago', () => {
		expect(dailyStreak([ev(1, '2026-01-08T10:00:00Z')], now, UTC)).toEqual({
			current: 0,
			best: 1,
			todayDone: false
		});
	});

	it('uses UTC midnight for day edges', () => {
		const r = [ev(1, '2026-01-09T23:59:59Z'), ev(2, '2026-01-10T00:00:00Z')];
		expect(dailyStreak(r, Date.parse('2026-01-10T00:00:01Z'), UTC).current).toBe(2);
	});

	it('ignores future-dated events for both current and best', () => {
		const r = [
			ev(1, '2026-01-09T10:00:00Z'),
			ev(2, '2026-01-12T10:00:00Z'),
			ev(3, '2026-01-13T10:00:00Z'),
			ev(4, '2026-01-14T10:00:00Z')
		];
		expect(dailyStreak(r, now, UTC)).toEqual({ current: 1, best: 1, todayDone: false });
	});
});

describe('the learner\'s day', () => {
	it('counts a Tokyo evening and the next morning as two XP days and a streak of 2', () => {
		// 14:00Z = 23:00 on the 9th in Tokyo, 15:30Z = 00:30 on the 10th.
		const r = [ev(1, '2026-01-09T14:00:00Z'), ev(2, '2026-01-09T15:30:00Z')];
		expect(xpFromReviews(r, UTC.dayOf)).toBe(10 + 10 + 10);
		expect(xpFromReviews(r, TOKYO.dayOf)).toBe(10 + 10 + 10 + 10);
		expect(dailyStreak(r, Date.parse('2026-01-09T16:00:00Z'), UTC)).toEqual({ current: 1, best: 1, todayDone: true });
		expect(dailyStreak(r, Date.parse('2026-01-09T16:00:00Z'), TOKYO)).toEqual({ current: 2, best: 2, todayDone: true });
	});

	it('one local day that spans two UTC dates is one streak day', () => {
		// Tokyo 2026-01-10 runs from 2026-01-09T15:00Z to 2026-01-10T15:00Z.
		const r = [ev(1, '2026-01-09T16:00:00Z'), ev(2, '2026-01-10T10:00:00Z')];
		expect(dailyStreak(r, Date.parse('2026-01-10T12:00:00Z'), TOKYO)).toEqual({ current: 1, best: 1, todayDone: true });
		expect(xpFromReviews(r, TOKYO.dayOf)).toBe(10 + 10 + 10);
		expect(xpFromReviews(r, UTC.dayOf)).toBe(10 + 10 + 20);
	});

	it('keeps a streak over the Berlin 23 and 25 hour days', () => {
		const berlin = studyDay([{ zone: 'Europe/Berlin', from: null }]);
		const spring = [
			ev(1, '2025-03-29T10:00:00Z'),
			ev(2, '2025-03-30T10:00:00Z'),
			ev(3, '2025-03-31T10:00:00Z')
		];
		expect(dailyStreak(spring, Date.parse('2025-03-31T12:00:00Z'), berlin)).toEqual({ current: 3, best: 3, todayDone: true });
		const autumn = [
			ev(1, '2025-10-25T10:00:00Z'),
			ev(2, '2025-10-26T00:30:00Z'), // 02:30 CEST on the 26th
			ev(3, '2025-10-26T22:59:59Z'), // 23:59:59 CET, the last second of the 25 hour day
			ev(4, '2025-10-27T10:00:00Z')
		];
		expect(dailyStreak(autumn, Date.parse('2025-10-27T12:00:00Z'), berlin)).toEqual({ current: 3, best: 3, todayDone: true });
	});

	it('does not repeat a day after a westward zone change', () => {
		const trip = studyDay([
			{ zone: 'Asia/Tokyo', from: null },
			{ zone: 'America/Los_Angeles', from: '2026-11-10T16:00:00Z' }
		]);
		const r = [ev(1, '2026-11-10T15:30:00Z'), ev(2, '2026-11-11T20:00:00Z'), ev(3, '2026-11-12T09:00:00Z')];
		expect(dailyStreak(r, Date.parse('2026-11-12T10:00:00Z'), trip)).toEqual({ current: 2, best: 2, todayDone: true });
	});
});

describe('fixtures: streak with vacation days', () => {
	for (const c of streakFixture.cases) {
		it(c.name, () => {
			const day = c.zone === 'UTC' ? UTC : studyDay([{ zone: c.zone, from: null }]);
			const reviews = c.reviews.map((ts, i) => ev(i + 1, ts));
			expect(dailyStreak(reviews, Date.parse(c.now), day, c.vacation)).toEqual(c.expect);
		});
	}
});
