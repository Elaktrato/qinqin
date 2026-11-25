import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudyDays } from '$lib/time/studyDays';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
import { studyContext, type TestContext } from '$lib/testing/context';
import * as build from '$lib/testing/study';
import type { GoalView } from '$lib/goals/loadGoal';
import { MAX_BUCKETS, MAX_VACATION_DATES, buildFacts, dueBucketsOf, factsOf, vacationDatesOf } from './facts';

vi.mock('../study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('../study/data')>()),
	loadStudyHistory: vi.fn()
}));
vi.mock('../goals/loadGoal', () => ({ loadGoalStatus: vi.fn() }));

import { loadStudyHistory } from '../study/data';
import { loadGoalStatus } from '../goals/loadGoal';
import { publishFacts } from './facts';

const NOW = new Date('2026-11-25T10:20:00Z');
const hour = (h: number, m = 0) => new Date(NOW.getTime() + h * 3_600_000 + m * 60_000).toISOString();

describe('dueBucketsOf', () => {
	it('groups future dues by the start of the UTC hour and sorts them', () => {
		const buckets = dueBucketsOf([hour(5, 5), hour(5, 30), hour(2), '2026-11-25T10:59:59.000Z'], NOW);
		expect(buckets).toEqual([
			{ at: '2026-11-25T10:00:00.000Z', count: 1 },
			{ at: '2026-11-25T12:00:00.000Z', count: 1 },
			{ at: '2026-11-25T15:00:00.000Z', count: 2 }
		]);
	});
	it('skips what is due now or past, what is beyond 14 days, and what is not a date', () => {
		expect(dueBucketsOf([hour(0), hour(-3), 'junk', hour(14 * 24 + 1), hour(14 * 24 - 2)], NOW)).toEqual([
			{ at: '2026-12-09T08:00:00.000Z', count: 1 }
		]);
	});
	it('keeps at most 400 buckets', () => {
		const dues = Array.from({ length: 1000 }, (_, i) => hour(1 + (i % 335)));
		expect(dueBucketsOf(dues, NOW).length).toBeLessThanOrEqual(MAX_BUCKETS);
	});
});

describe('vacationDatesOf', () => {
	it('lists the covered days of the next 60, today included', () => {
		const dates = vacationDatesOf([{ start: '2026-11-24', end: '2026-11-27' }], '2026-11-25');
		expect(dates).toEqual(['2026-11-25', '2026-11-26', '2026-11-27']);
	});
	it('is at most 60 dates for an open run and none without runs', () => {
		const dates = vacationDatesOf([{ start: '2026-01-01', end: '2027-12-31' }], '2026-11-25');
		expect(dates.length).toBe(60);
		expect(dates.length).toBeLessThanOrEqual(MAX_VACATION_DATES);
		expect(vacationDatesOf([], '2026-11-25')).toEqual([]);
	});
});

describe('buildFacts', () => {
	it('is the contract body', () => {
		const facts = buildFacts({
			workspace: 3,
			now: NOW,
			dueNow: 12,
			dues: [hour(4)],
			goal: { set: true, status: 'open' },
			streak: { current: 5, todayMet: false },
			vacation: ['2026-11-27']
		});
		expect(facts).toEqual({
			workspace: 3,
			asOf: '2026-11-25T10:20:00.000Z',
			dueNow: 12,
			dueBuckets: [{ at: '2026-11-25T14:00:00.000Z', count: 1 }],
			goal: { set: true, status: 'open' },
			streak: { current: 5, todayMet: false },
			vacation: ['2026-11-27']
		});
	});
	it('clamps counts to 0..1,000,000 as integers', () => {
		const facts = buildFacts({ workspace: 1, now: NOW, dueNow: 5e9, dues: [], goal: { set: false, status: 'none' }, streak: { current: -2.5, todayMet: false }, vacation: [] });
		expect(facts.dueNow).toBe(1_000_000);
		expect(facts.streak.current).toBe(0);
	});
});

describe('factsOf (a goal view to the goal and streak facts)', () => {
	const view = (status: string, streak: GoalView['streak'], row: object | null = {}): GoalView =>
		({ row, newer: false, today: { status }, streak }) as unknown as GoalView;
	it('maps the status; "missed" and "none" are no goal', () => {
		expect(factsOf(view('open', null)).goal).toEqual({ set: true, status: 'open' });
		expect(factsOf(view('met', null)).goal).toEqual({ set: true, status: 'met' });
		expect(factsOf(view('vacation', null)).goal).toEqual({ set: true, status: 'vacation' });
		expect(factsOf(view('none', null, null)).goal).toEqual({ set: false, status: 'none' });
		expect(factsOf(view('missed', null)).goal).toEqual({ set: false, status: 'none' });
	});
	it('the streak is 0 / false without one', () => {
		expect(factsOf(view('open', null)).streak).toEqual({ current: 0, todayMet: false });
		expect(factsOf(view('open', { current: 4, todayMet: true, capped: false })).streak).toEqual({ current: 4, todayMet: true });
	});
});

describe('publishFacts', () => {
	let ctx: TestContext;
	beforeEach(() => {
		vi.spyOn(StudyDays.prototype, 'day').mockImplementation((() => studyDayOf([])) as never);
		ctx = studyContext();
		vi.mocked(loadStudyHistory).mockResolvedValue(build.history({}));
		vi.mocked(loadGoalStatus).mockResolvedValue({
			row: {},
			newer: false,
			today: { status: 'open' },
			streak: { current: 2, todayMet: false, capped: false }
		} as unknown as GoalView);
	});
	afterEach(() => vi.clearAllMocks());

	it('PUTs the workspace facts of an empty study state', async () => {
		const put = vi.fn(async () => undefined);
		const api = vi.fn(put) as never;
		await publishFacts(ctx.session, 3, { api, now: () => NOW.getTime() });
		expect(api).toHaveBeenCalledTimes(1);
		const [path, options] = (api as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { method: string; body: Record<string, unknown> }];
		expect(path).toBe('/api/reminders/facts');
		expect(options.method).toBe('PUT');
		expect(options.body).toMatchObject({
			workspace: 3,
			asOf: NOW.toISOString(),
			dueNow: 0,
			dueBuckets: [],
			goal: { set: true, status: 'open' },
			streak: { current: 2, todayMet: false },
			vacation: []
		});
	});
});
