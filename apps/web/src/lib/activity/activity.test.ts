import { describe, expect, it } from 'vitest';
import type { ActivityResponse, ActivitySource } from '../api/stats';
import {
	HEATMAP_DAYS,
	dayTooltip,
	foldRange,
	describe as describeActivity,
	foldActivity,
	levelFor,
	sourcePoints,
	windowStart,
	vacationMarks,
	windowSummary
} from './activity';
import { studyDay } from '../time/studyDay';

const NOW = new Date('2026-11-13T12:00:00Z');
const UTC = studyDay([]);
const TOKYO = studyDay([{ zone: 'Asia/Tokyo', from: null }]);
const fold = (
	r: ActivityResponse,
	v: { workspace: number | null; hidden: readonly string[] },
	now: Date = NOW,
	days?: number
) => foldActivity(r, v, UTC, now, days);

const SOURCES: ActivitySource[] = [
	{
		type: 'review',
		feature: 'flashcards',
		unit: 'count'
	},
	{
		type: 'read',
		feature: 'reader',
		unit: 'seconds'
	},
	{
		type: 'journal',
		feature: 'journal',
		unit: 'count'
	}
];

function resp(cells: ActivityResponse['cells']): ActivityResponse {
	return { from: '2026-08-15', to: '2026-11-13', timeZone: 'UTC', sources: SOURCES, cells };
}

const cell = (day: string, workspace: number, type: string, points: number, raw = points) => ({
	day,
	workspace,
	type,
	points,
	raw
});

const ALL = { workspace: null, hidden: [] as string[] };

describe('foldActivity', () => {
	const cells = [
		cell('2026-11-13', 3, 'review', 9),
		cell('2026-11-13', 3, 'read', 3, 900),
		cell('2026-11-13', 4, 'review', 2),
		cell('2026-11-12', 4, 'journal', 1)
	];

	it('lists 364 days oldest first, empty days zero', () => {
		const map = fold(resp([]), ALL, NOW);
		const keys = [...map.keys()];
		expect(keys).toHaveLength(HEATMAP_DAYS);
		expect(keys[0]).toBe('2025-11-15');
		expect(keys.at(-1)).toBe('2026-11-13');
		expect(map.get('2026-11-01')).toEqual({
			day: '2026-11-01',
			total: 0,
			bySource: {},
			raw: {},
			byWorkspace: {},
			vacation: null,
			vacationIn: []
		});
	});

	it('keeps only one workspace for a workspace scope', () => {
		const day = fold(resp(cells), { workspace: 3, hidden: [] }, NOW).get('2026-11-13')!;
		expect(day.total).toBe(12);
		expect(day.bySource).toEqual({ review: 9, read: 3 });
		expect(day.raw).toEqual({ review: 9, read: 900 });
		expect(day.byWorkspace).toEqual({});
		expect(fold(resp(cells), { workspace: 3, hidden: [] }, NOW).get('2026-11-12')!.total).toBe(0);
	});

	it('sums all workspaces and fills byWorkspace', () => {
		const map = fold(resp(cells), ALL, NOW);
		const day = map.get('2026-11-13')!;
		expect(day.total).toBe(14);
		expect(day.bySource).toEqual({ review: 11, read: 3 });
		expect(day.byWorkspace).toEqual({ 3: 12, 4: 2 });
		expect(map.get('2026-11-12')!.byWorkspace).toEqual({ 4: 1 });
	});

	it('removes hidden types from totals and bySource', () => {
		const day = fold(resp(cells), { workspace: null, hidden: ['read'] }, NOW).get('2026-11-13')!;
		expect(day.total).toBe(11);
		expect(day.bySource).toEqual({ review: 11 });
		expect(day.raw).toEqual({ review: 11 });
		expect(day.byWorkspace).toEqual({ 3: 9, 4: 2 });
	});

	it('ignores unknown types and cells outside the window', () => {
		const map = fold(
			resp([
				cell('2026-11-13', 3, 'mystery', 5),
				cell('2025-11-14', 3, 'review', 5),
				cell('2026-11-14', 3, 'review', 5),
				cell('not-a-day', 3, 'review', 5),
				cell('2025-11-15', 3, 'review', 1)
			]),
			ALL,
			NOW
		);
		expect([...map.values()].reduce((sum, d) => sum + d.total, 0)).toBe(1);
		expect(map.get('2025-11-15')!.total).toBe(1);
		expect(map.size).toBe(HEATMAP_DAYS);
	});
});

describe('describe', () => {
	it('uses the one and other forms of a count', () => {
		expect(describeActivity(SOURCES[0], 1)).toBe('1 flashcard review');
		expect(describeActivity(SOURCES[0], 2)).toBe('2 flashcard reviews');
	});

	it('turns seconds into whole minutes, at least 1', () => {
		expect(describeActivity(SOURCES[1], 900)).toBe('15 minutes of reading');
		expect(describeActivity(SOURCES[1], 20)).toBe('1 minute of reading');
		expect(describeActivity(SOURCES[1], 60)).toBe('1 minute of reading');
	});
});

describe('sourcePoints', () => {
	it('sums the window per type', () => {
		const map = fold(
			resp([cell('2026-11-13', 3, 'review', 9), cell('2026-11-12', 3, 'review', 2)]),
			ALL,
			NOW
		);
		expect(sourcePoints(map)).toEqual({ review: 11 });
	});
});

describe('dayTooltip', () => {
	const names = (id: number) => (id === 3 ? '中文' : id === 4 ? '日本語' : `Workspace ${id}`);

	it('uses the rules own wording', () => {
		const day = fold(
			resp([cell('2026-11-13', 3, 'review', 9), cell('2026-11-13', 3, 'read', 3, 900)]),
			{ workspace: 3, hidden: [] },
			NOW
		).get('2026-11-13')!;
		expect(dayTooltip(day, SOURCES, names)).toBe(
			'2026-11-13: 12 points — 9 flashcard reviews, 15 minutes of reading'
		);
	});

	it('adds the workspaces in the combined view', () => {
		const day = fold(
			resp([
				cell('2026-11-13', 3, 'review', 8),
				cell('2026-11-13', 4, 'review', 1),
				cell('2026-11-13', 4, 'read', 3, 900)
			]),
			ALL,
			NOW
		).get('2026-11-13')!;
		expect(dayTooltip(day, SOURCES, names)).toBe(
			'2026-11-13: 12 points — 9 flashcard reviews, 15 minutes of reading · 中文 8, 日本語 4'
		);
	});

	it('uses a fallback name verbatim', () => {
		const day = fold(resp([cell('2026-11-13', 7, 'review', 1)]), ALL, NOW).get('2026-11-13')!;
		expect(dayTooltip(day, SOURCES, names)).toBe(
			'2026-11-13: 1 point — 1 flashcard review · Workspace 7 1'
		);
	});

	it('with a stage appends the stage phrase, and today', () => {
		const day = fold(resp([cell('2026-11-13', 3, 'review', 9)]), { workspace: 3, hidden: [] }, NOW).get('2026-11-13')!;
		const stage = { stage: 'bud' as const, status: 'open' as const, metric: 'activity:review' as const, amount: 21, target: 50 };
		expect(dayTooltip(day, SOURCES, names, false, { stage })).toBe(
			'2026-11-13: 9 points — 9 flashcard reviews · 21 of 50 — Bud'
		);
		expect(dayTooltip(day, SOURCES, names, false, { stage, today: true })).toBe(
			'2026-11-13: 9 points — 9 flashcard reviews · 21 of 50 — Bud · today'
		);
		const empty = fold(resp([]), { workspace: 3, hidden: [] }, NOW).get('2026-11-13')!;
		expect(dayTooltip(empty, SOURCES, names, false, { stage: { ...stage, stage: 'soil', amount: 0 } })).toBe(
			'2026-11-13: no activity · 0 of 50 — Nothing yet'
		);
	});

	it('foldRange folds any window, not only the one ending today', () => {
		const map = foldRange(resp([cell('2026-10-31', 3, 'review', 2), cell('2026-11-01', 3, 'review', 1)]), { workspace: 3, hidden: [] }, '2026-10-01', '2026-10-31');
		expect(map.size).toBe(31);
		expect(map.get('2026-10-31')?.total).toBe(2);
		expect(map.has('2026-11-01')).toBe(false);
	});

	it('says hidden, not no activity, when every type is hidden', () => {
		const day = fold(resp([]), ALL, NOW).get('2026-11-13')!;
		expect(dayTooltip(day, SOURCES, names, true)).toBe('2026-11-13: all activity types hidden');
	});

	it('reports an empty day', () => {
		const day = fold(resp([]), ALL, NOW).get('2026-11-13')!;
		expect(dayTooltip(day, SOURCES, names)).toBe('2026-11-13: no activity');
	});
});

describe('windowSummary', () => {
	const map = fold(
		resp([cell('2026-11-13', 3, 'review', 2), cell('2026-11-12', 3, 'read', 19, 5700)]),
		ALL,
		NOW
	);

	it('names the scope and the totals', () => {
		expect(windowSummary(map, SOURCES, 'workspace')).toBe(
			'Learning activity in this workspace for the last 52 weeks: 21 points — 2 flashcard reviews, 95 minutes of reading'
		);
		expect(windowSummary(map, SOURCES, 'all')).toContain('in all workspaces for the last 52 weeks');
	});

	it('says so when there is no activity', () => {
		expect(windowSummary(fold(resp([]), ALL, NOW), SOURCES, 'workspace')).toBe(
			'Learning activity in this workspace for the last 52 weeks: no activity yet'
		);
	});
});

describe('windowStart', () => {
	it("is the window's first learner day", () => {
		expect(windowStart(UTC, NOW)).toBe('2025-11-15');
		expect(windowStart(UTC, NOW, 7)).toBe('2026-11-07');
		expect(windowStart(UTC, NOW, 0)).toBe('2026-11-13');
		expect(windowStart(UTC, NOW)).toBe([...fold(resp([]), ALL).keys()][0]);
	});

	it('follows the learner zone: 15:30Z is already tomorrow in Tokyo', () => {
		const late = new Date('2026-11-13T15:30:00Z');
		expect(windowStart(TOKYO, late, 7)).toBe('2026-11-08');
		expect([...foldActivity(resp([]), ALL, TOKYO, late, 7).keys()].at(-1)).toBe('2026-11-14');
		expect([...foldActivity(resp([]), ALL, UTC, late, 7).keys()].at(-1)).toBe('2026-11-13');
	});
});

describe('foldActivity by learner day', () => {
	it('puts cells on the learner days the server named', () => {
		const late = new Date('2026-11-13T15:30:00Z');
		const map = foldActivity(
			resp([cell('2026-11-14', 3, 'review', 2), cell('2026-11-13', 3, 'review', 1)]),
			ALL,
			TOKYO,
			late,
			3
		);
		expect([...map.keys()]).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
		expect(map.get('2026-11-14')!.total).toBe(2);
	});

	it('has exactly 364 civil days across the Berlin spring-forward change', () => {
		const berlin = studyDay([{ zone: 'Europe/Berlin', from: null }]);
		const map = foldActivity(resp([]), ALL, berlin, new Date('2025-04-10T12:00:00Z'));
		const keys = [...map.keys()];
		expect(keys).toHaveLength(HEATMAP_DAYS);
		expect(keys).toContain('2025-03-30');
		expect(new Set(keys).size).toBe(HEATMAP_DAYS);
		expect(keys[0]).toBe('2024-04-12');
		expect(keys.at(-1)).toBe('2025-04-10');
	});

	it('has 364 days across the autumn 25 hour day and a westward zone change', () => {
		const trip = studyDay([
			{ zone: 'Asia/Tokyo', from: null },
			{ zone: 'America/Los_Angeles', from: '2026-11-10T16:00:00Z' }
		]);
		const map = foldActivity(resp([]), ALL, trip, new Date('2026-11-12T07:59:59Z'));
		expect(map.size).toBe(HEATMAP_DAYS);
		expect([...map.keys()].at(-1)).toBe('2026-11-11');
	});
});

describe('levelFor', () => {
	it.each([
		[0, 0],
		[-1, 0],
		[1, 1],
		[2, 2],
		[3, 2],
		[4, 3],
		[6, 3],
		[7, 4],
		[100, 4]
	])('%i -> level %i', (count, level) => {
		expect(levelFor(count)).toBe(level);
	});
});

describe('vacation marks', () => {
	const period = (id: string, start: string, end: string, scope: 'all' | { workspaces: number[] }) => ({
		version: 1 as const, id, start, end, scope, createdDay: '2026-01-01', createdAt: '2026-01-01T00:00:00Z'
	});
	const empty = resp([]);

	it('marks a workspace view by its own runs', () => {
		const marks = vacationMarks([period('A', '2026-11-10', '2026-11-11', { workspaces: [2] })], [1, 2], 2, UTC, NOW);
		expect(marks.get('2026-11-10')).toEqual({ mode: 'all', workspaces: [2] });
		expect(marks.get('2026-11-12')).toBeUndefined();
		expect(vacationMarks([period('A', '2026-11-10', '2026-11-11', { workspaces: [2] })], [1, 2], 1, UTC, NOW).size).toBe(0);
	});

	it('marks the all-workspaces view "all" only when every workspace is away', () => {
		const periods = [period('A', '2026-11-10', '2026-11-11', 'all'), period('B', '2026-11-12', '2026-11-12', { workspaces: [2] })];
		const marks = vacationMarks(periods, [1, 2], null, UTC, NOW);
		expect(marks.get('2026-11-10')).toEqual({ mode: 'all', workspaces: [1, 2] });
		expect(marks.get('2026-11-12')).toEqual({ mode: 'some', workspaces: [2] });
	});

	it('puts the marks on the folded days and into the tooltip', () => {
		const periods = [period('A', '2026-11-10', '2026-11-10', 'all'), period('B', '2026-11-12', '2026-11-12', { workspaces: [2] })];
		const marks = vacationMarks(periods, [1, 2], null, UTC, NOW);
		const map = foldActivity(empty, { workspace: null, hidden: [] }, UTC, NOW, HEATMAP_DAYS, marks);
		const names = (id: number) => (id === 2 ? '日本語' : '中文');
		expect(map.get('2026-11-10')?.vacation).toBe('all');
		expect(map.get('2026-11-12')?.vacation).toBe('some');
		expect(map.get('2026-11-11')?.vacation).toBeNull();
		expect(dayTooltip(map.get('2026-11-10')!, SOURCES, names)).toBe('2026-11-10: no activity · On vacation');
		expect(dayTooltip(map.get('2026-11-12')!, SOURCES, names)).toBe('2026-11-12: no activity · Vacation in 日本語');
		expect(dayTooltip(map.get('2026-11-11')!, SOURCES, names)).toBe('2026-11-11: no activity');
	});
});
