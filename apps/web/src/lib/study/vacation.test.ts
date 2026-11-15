import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/scheduler/vacation-days.json';
import {
	currentVacation,
	isVacationDay,
	parseVacation,
	planCancel,
	planCreate,
	planEndEarly,
	vacationRuns,
	type Draft,
	type VacationPeriod
} from './vacation';

type Row = { key: string; value: unknown };

function periods(rows: Row[]): VacationPeriod[] {
	return rows.flatMap((row) => {
		const p = parseVacation(row.key, row.value);
		return p === null ? [] : [p];
	});
}

describe('fixtures: vacation runs', () => {
	for (const c of fixture.runs) {
		it(c.name, () => {
			expect(vacationRuns(periods(c.rows as Row[]), c.workspaceId, c.today)).toEqual(c.runs);
		});
	}
});

describe('fixtures: creating a period', () => {
	for (const c of fixture.create) {
		it(c.name, () => {
			const reviewed = new Set<number>(c.reviewedTodayIn);
			const result = planCreate(c.existing as VacationPeriod[], c.draft as Draft, {
				today: c.today,
				now: new Date(c.now),
				reviewedToday: (w) => (w === 'all' ? reviewed.size > 0 : reviewed.has(w)),
				newId: () => c.newId
			});
			expect(result).toEqual(c.expect);
		});
	}
});

describe('fixtures: ending and cancelling', () => {
	for (const c of fixture.edit) {
		it(c.name, () => {
			const period = c.period as VacationPeriod;
			const result =
				c.op === 'endEarly' ? planEndEarly(period, c.today) : planCancel(period, c.today);
			expect(result).toEqual(c.expect);
		});
	}
});

describe('run helpers', () => {
	const runs = [
		{ start: '2026-12-01', end: '2026-12-05' },
		{ start: '2026-12-10', end: '2026-12-12' }
	];
	it('isVacationDay is inclusive on both ends', () => {
		expect(isVacationDay(runs, '2026-11-30')).toBe(false);
		expect(isVacationDay(runs, '2026-12-01')).toBe(true);
		expect(isVacationDay(runs, '2026-12-05')).toBe(true);
		expect(isVacationDay(runs, '2026-12-06')).toBe(false);
		expect(isVacationDay(runs, '2026-12-12')).toBe(true);
	});
	it('currentVacation is the run containing today', () => {
		expect(currentVacation(runs, '2026-12-03')).toEqual(runs[0]);
		expect(currentVacation(runs, '2026-12-07')).toBeNull();
	});
});
