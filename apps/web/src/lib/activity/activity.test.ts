import { describe, expect, it } from 'vitest';
import type { ActivityResponse, ActivitySource } from '../api/stats';
import {
	HEATMAP_DAYS,
	dayKey,
	dayTooltip,
	describe as describeActivity,
	foldActivity,
	levelFor,
	sourcePoints,
	windowStart,
	windowSummary
} from './activity';

const NOW = new Date('2026-11-13T12:00:00Z');

const SOURCES: ActivitySource[] = [
	{
		type: 'review',
		plugin: 'qinqin-flashcards',
		label: 'Flashcard reviews',
		unit: 'count',
		describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' }
	},
	{
		type: 'read',
		plugin: 'qinqin-reader',
		label: 'Reading',
		unit: 'seconds',
		describe: { one: '{n} minute of reading', other: '{n} minutes of reading' }
	},
	{
		type: 'journal',
		plugin: 'qinqin-journal',
		label: 'Journal entries',
		unit: 'count',
		describe: { one: '{n} journal entry', other: '{n} journal entries' }
	}
];

function resp(cells: ActivityResponse['cells']): ActivityResponse {
	return { from: '2026-08-15', to: '2026-11-13', sources: SOURCES, cells };
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

	it('lists 91 days oldest first, empty days zero', () => {
		const map = foldActivity(resp([]), ALL, NOW);
		const keys = [...map.keys()];
		expect(keys).toHaveLength(HEATMAP_DAYS);
		expect(keys[0]).toBe('2026-08-15');
		expect(keys[90]).toBe('2026-11-13');
		expect(map.get('2026-11-01')).toEqual({
			day: '2026-11-01',
			total: 0,
			bySource: {},
			raw: {},
			byWorkspace: {}
		});
	});

	it('keeps only one workspace for a workspace scope', () => {
		const day = foldActivity(resp(cells), { workspace: 3, hidden: [] }, NOW).get('2026-11-13')!;
		expect(day.total).toBe(12);
		expect(day.bySource).toEqual({ review: 9, read: 3 });
		expect(day.raw).toEqual({ review: 9, read: 900 });
		expect(day.byWorkspace).toEqual({});
		expect(foldActivity(resp(cells), { workspace: 3, hidden: [] }, NOW).get('2026-11-12')!.total).toBe(0);
	});

	it('sums all workspaces and fills byWorkspace', () => {
		const map = foldActivity(resp(cells), ALL, NOW);
		const day = map.get('2026-11-13')!;
		expect(day.total).toBe(14);
		expect(day.bySource).toEqual({ review: 11, read: 3 });
		expect(day.byWorkspace).toEqual({ 3: 12, 4: 2 });
		expect(map.get('2026-11-12')!.byWorkspace).toEqual({ 4: 1 });
	});

	it('removes hidden types from totals and bySource', () => {
		const day = foldActivity(resp(cells), { workspace: null, hidden: ['read'] }, NOW).get('2026-11-13')!;
		expect(day.total).toBe(11);
		expect(day.bySource).toEqual({ review: 11 });
		expect(day.raw).toEqual({ review: 11 });
		expect(day.byWorkspace).toEqual({ 3: 9, 4: 2 });
	});

	it('ignores unknown types and cells outside the window', () => {
		const map = foldActivity(
			resp([
				cell('2026-11-13', 3, 'mystery', 5),
				cell('2026-08-14', 3, 'review', 5),
				cell('2026-11-14', 3, 'review', 5),
				cell('not-a-day', 3, 'review', 5),
				cell('2026-08-15', 3, 'review', 1)
			]),
			ALL,
			NOW
		);
		expect([...map.values()].reduce((sum, d) => sum + d.total, 0)).toBe(1);
		expect(map.get('2026-08-15')!.total).toBe(1);
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
		const map = foldActivity(
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
		const day = foldActivity(
			resp([cell('2026-11-13', 3, 'review', 9), cell('2026-11-13', 3, 'read', 3, 900)]),
			{ workspace: 3, hidden: [] },
			NOW
		).get('2026-11-13')!;
		expect(dayTooltip(day, SOURCES, names)).toBe(
			'2026-11-13: 12 points — 9 flashcard reviews, 15 minutes of reading'
		);
	});

	it('adds the workspaces in the combined view', () => {
		const day = foldActivity(
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
		const day = foldActivity(resp([cell('2026-11-13', 7, 'review', 1)]), ALL, NOW).get('2026-11-13')!;
		expect(dayTooltip(day, SOURCES, names)).toBe(
			'2026-11-13: 1 point — 1 flashcard review · Workspace 7 1'
		);
	});

	it('reports an empty day', () => {
		const day = foldActivity(resp([]), ALL, NOW).get('2026-11-13')!;
		expect(dayTooltip(day, SOURCES, names)).toBe('2026-11-13: no activity');
	});
});

describe('windowSummary', () => {
	const map = foldActivity(
		resp([cell('2026-11-13', 3, 'review', 2), cell('2026-11-12', 3, 'read', 19, 5700)]),
		ALL,
		NOW
	);

	it('names the scope and the totals', () => {
		expect(windowSummary(map, SOURCES, 'workspace')).toBe(
			'Learning activity in this workspace for the last 13 weeks: 21 points — 2 flashcard reviews, 95 minutes of reading'
		);
		expect(windowSummary(map, SOURCES, 'all')).toContain('in all workspaces for the last 13 weeks');
	});

	it('says so when there is no activity', () => {
		expect(windowSummary(foldActivity(resp([]), ALL, NOW), SOURCES, 'workspace')).toBe(
			'Learning activity in this workspace for the last 13 weeks: no activity yet'
		);
	});
});

describe('windowStart and dayKey', () => {
	it("is UTC midnight of the window's first day", () => {
		expect(windowStart(NOW).toISOString()).toBe('2026-08-15T00:00:00.000Z');
		expect(windowStart(NOW, 7).toISOString()).toBe('2026-11-07T00:00:00.000Z');
	});

	it('formats a UTC day', () => {
		expect(dayKey(new Date('2026-11-13T23:59:59Z'))).toBe('2026-11-13');
		expect(dayKey(windowStart(NOW))).toBe([...foldActivity(resp([]), ALL, NOW).keys()][0]);
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
