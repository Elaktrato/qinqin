import { describe, expect, it } from 'vitest';
import type { ActivityResponse, ActivitySource } from '../api/stats';
import {
	HEATMAP_DAYS,
	dayTooltip,
	describe as describeActivity,
	foldActivity,
	levelFor,
	sourcePoints,
	windowStart,
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

	it('lists 91 days oldest first, empty days zero', () => {
		const map = fold(resp([]), ALL, NOW);
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
			'Learning activity in this workspace for the last 13 weeks: 21 points — 2 flashcard reviews, 95 minutes of reading'
		);
		expect(windowSummary(map, SOURCES, 'all')).toContain('in all workspaces for the last 13 weeks');
	});

	it('says so when there is no activity', () => {
		expect(windowSummary(fold(resp([]), ALL, NOW), SOURCES, 'workspace')).toBe(
			'Learning activity in this workspace for the last 13 weeks: no activity yet'
		);
	});
});

describe('windowStart', () => {
	it("is the window's first learner day", () => {
		expect(windowStart(UTC, NOW)).toBe('2026-08-15');
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

	it('has exactly 91 civil days across the Berlin spring-forward change', () => {
		const berlin = studyDay([{ zone: 'Europe/Berlin', from: null }]);
		const map = foldActivity(resp([]), ALL, berlin, new Date('2025-04-10T12:00:00Z'));
		const keys = [...map.keys()];
		expect(keys).toHaveLength(HEATMAP_DAYS);
		expect(keys).toContain('2025-03-30');
		expect(new Set(keys).size).toBe(HEATMAP_DAYS);
		expect(keys[0]).toBe('2025-01-10');
		expect(keys.at(-1)).toBe('2025-04-10');
	});

	it('has 91 days across the autumn 25 hour day and a westward zone change', () => {
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
