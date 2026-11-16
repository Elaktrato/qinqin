import { describe, expect, it } from 'vitest';
import { addDays } from '../time/studyDay';
import fixture from '../../../../../docs/contracts/goals/goal-rows.json';
import {
	GOALS_KEY,
	MAX_GOAL_ENTRIES,
	goalOn,
	isGoalMetric,
	parseGoalsRow,
	planGoalEdit,
	targetRange,
	type GoalEdit,
	type GoalsRow
} from './goals';

interface ParseCase {
	name: string;
	op: 'parse';
	key: string;
	raw: unknown;
	expect: unknown;
}
interface EditCase {
	name: string;
	op: 'edit';
	today: string;
	row: unknown;
	edit: GoalEdit;
	expect: unknown;
}
const cases = fixture.cases as unknown as (ParseCase | EditCase)[];

function rowOf(raw: unknown): GoalsRow | null {
	const parsed = parseGoalsRow(raw);
	if (parsed === 'newer') throw new Error('fixture row is newer');
	return parsed;
}

describe('goal-rows.json', () => {
	it('has parse and edit cases', () => {
		expect(cases.filter((c) => c.op === 'parse').length).toBeGreaterThan(10);
		expect(cases.filter((c) => c.op === 'edit').length).toBeGreaterThan(10);
	});

	it.each(cases.filter((c): c is ParseCase => c.op === 'parse').map((c) => [c.name, c] as const))(
		'parse: %s',
		(_name, c) => {
			expect(c.key).toBe(GOALS_KEY);
			expect(parseGoalsRow(c.raw)).toEqual(c.expect);
		}
	);

	it.each(cases.filter((c): c is EditCase => c.op === 'edit').map((c) => [c.name, c] as const))(
		'edit: %s',
		(_name, c) => {
			expect(planGoalEdit(rowOf(c.row), c.edit, c.today)).toEqual(c.expect);
		}
	);
});

describe('parseGoalsRow', () => {
	const one = (entry: Record<string, unknown>) =>
		parseGoalsRow({ version: 1, history: [{ from: '2026-11-16', ...entry }] });

	it('drops out-of-range and fractional targets', () => {
		for (const target of [0, 10000, 1.5, -1, Number.NaN]) {
			expect(one({ metric: 'flashcards:new', target })).toEqual({ version: 1, showStreak: true, history: [] });
		}
		expect(one({ metric: 'flashcards:new', target: 9999 })).not.toEqual({ version: 1, showStreak: true, history: [] });
	});

	it('limits study time to 1..1440 minutes', () => {
		expect((one({ metric: 'flashcards:studyTime', target: 1440 }) as GoalsRow).history).toHaveLength(1);
		expect((one({ metric: 'flashcards:studyTime', target: 1441 }) as GoalsRow).history).toHaveLength(0);
		expect((one({ metric: 'flashcards:studyTime', target: 1 }) as GoalsRow).history).toHaveLength(1);
	});

	it('round-trips unknown keys of the row and of entries', () => {
		const raw = {
			version: 1,
			showStreak: false,
			extra: [1, 2],
			history: [{ from: '2026-11-16', metric: 'activity:read', target: 20, color: 'red' }]
		};
		const row = parseGoalsRow(raw) as GoalsRow;
		expect(row).toEqual(raw);
		const written = planGoalEdit(row, { metric: 'activity:read', target: 30 }, '2026-11-17');
		expect(written?.extra).toEqual([1, 2]);
		expect(written?.history[0].color).toBe('red');
	});
});

describe('isGoalMetric and targetRange', () => {
	it('knows the metrics', () => {
		expect(isGoalMetric('activity:review')).toBe(true);
		expect(isGoalMetric('flashcards:new')).toBe(true);
		expect(isGoalMetric('flashcards:studyTime')).toBe(true);
		expect(isGoalMetric('activity:')).toBe(false);
		expect(isGoalMetric(`activity:${'x'.repeat(65)}`)).toBe(false);
		expect(isGoalMetric('flashcards:old')).toBe(false);
		expect(isGoalMetric(3)).toBe(false);
	});

	it('gives the range in display units', () => {
		expect(targetRange('flashcards:new', null)).toEqual({ min: 1, max: 9999, unit: 'count' });
		expect(targetRange('flashcards:studyTime', null)).toEqual({ min: 1, max: 1440, unit: 'minutes' });
		expect(targetRange('activity:read', 'seconds')).toEqual({ min: 1, max: 1440, unit: 'minutes' });
		expect(targetRange('activity:review', 'count')).toEqual({ min: 1, max: 9999, unit: 'count' });
	});
});

describe('goalOn', () => {
	const row = parseGoalsRow({
		version: 1,
		history: [
			{ from: '2026-11-10', metric: 'activity:review', target: 50 },
			{ from: '2026-11-15', metric: null, target: null },
			{ from: '2026-11-20', metric: 'flashcards:new', target: 5 }
		]
	}) as GoalsRow;

	it('is the last entry with from <= day', () => {
		expect(goalOn(row, '2026-11-09')).toBeNull();
		expect(goalOn(row, '2026-11-10')).toEqual({ metric: 'activity:review', target: 50 });
		expect(goalOn(row, '2026-11-14')).toEqual({ metric: 'activity:review', target: 50 });
		expect(goalOn(row, '2026-11-15')).toBeNull();
		expect(goalOn(row, '2026-11-25')).toEqual({ metric: 'flashcards:new', target: 5 });
		expect(goalOn(null, '2026-11-25')).toBeNull();
	});
});

describe('planGoalEdit', () => {
	it('keeps at most MAX_GOAL_ENTRIES, dropping the oldest', () => {
		const history = Array.from({ length: MAX_GOAL_ENTRIES }, (_, i) => ({
			from: addDays('2025-01-01', i),
			metric: 'activity:review' as const,
			target: i + 1
		}));
		expect(MAX_GOAL_ENTRIES).toBe(400);
		const row = parseGoalsRow({ version: 1, history }) as GoalsRow;
		const next = planGoalEdit(row, { metric: 'activity:review', target: 9 }, '2026-11-16')!;
		expect(next.history).toHaveLength(400);
		expect(next.history[0]).toEqual(history[1]);
		expect(next.history[399]).toEqual({ from: '2026-11-16', metric: 'activity:review', target: 9 });
	});

	it('throws on a newer row', () => {
		expect(() => planGoalEdit('newer', null, '2026-11-16')).toThrow();
	});

	it('throws on an invalid edit', () => {
		expect(() => planGoalEdit(null, { metric: 'flashcards:new', target: 0 }, '2026-11-16')).toThrow();
		expect(() => planGoalEdit(null, { metric: 'nope' as 'flashcards:new', target: 5 }, '2026-11-16')).toThrow();
		expect(() => planGoalEdit(null, null, '2026-02-30')).toThrow();
	});

	it('does not mutate its input', () => {
		const row = parseGoalsRow({
			version: 1,
			history: [{ from: '2026-11-16', metric: 'activity:review', target: 5 }]
		}) as GoalsRow;
		const copy = structuredClone(row);
		planGoalEdit(row, { metric: 'activity:review', target: 6 }, '2026-11-16');
		planGoalEdit(row, { showStreak: false }, '2026-11-16');
		expect(row).toEqual(copy);
	});
});
