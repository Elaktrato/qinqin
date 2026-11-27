import { describe, expect, it } from 'vitest';
import daysFixture from '../../../../../docs/contracts/goals/goal-days.json';
import streakFixture from '../../../../../docs/contracts/goals/goal-streak.json';
import { addDays } from '../time/studyDay';
import type { Run } from '$lib/studycore/vacation';
import { NO_AMOUNTS, type DayAmounts } from './amounts';
import { parseGoalsRow, type GoalsRow } from './goals';
import { goalDay, goalDays, goalStreak, type UnitOf } from './progress';

interface Common {
	name: string;
	today: string;
	units: Record<string, 'count' | 'seconds'>;
	vacation: Run[];
	row: unknown;
	days: Record<string, DayAmounts>;
}
type DaysCase = Common & { from: string; to: string; expect: unknown[] };
type StreakCase = Common & { windowStart: string; expect: unknown };

function inputs(c: Common) {
	const parsed = parseGoalsRow(c.row);
	if (parsed === 'newer') throw new Error('newer fixture row');
	const unitOf: UnitOf = (type) => c.units[type] ?? null;
	const of = (day: string): DayAmounts => c.days[day] ?? NO_AMOUNTS;
	return { row: parsed, unitOf, of };
}

describe('goal-days.json', () => {
	it.each((daysFixture.cases as unknown as DaysCase[]).map((c) => [c.name, c] as const))('%s', (_n, c) => {
		const { row, unitOf, of } = inputs(c);
		const out = goalDays(row, c.from, c.to, c.today, of, c.vacation, unitOf);
		expect(
			out.map(({ day, status, metric, target, amount, unavailable }) => ({
				day,
				status,
				metric,
				target,
				amount,
				unavailable
			}))
		).toEqual(c.expect);
	});
});

describe('goal-streak.json', () => {
	it.each((streakFixture.cases as unknown as StreakCase[]).map((c) => [c.name, c] as const))('%s', (_n, c) => {
		const { row, unitOf, of } = inputs(c);
		expect(goalStreak(row, c.today, c.windowStart, of, c.vacation, unitOf)).toEqual(c.expect);
	});
});

const units: UnitOf = (t) => (t === 'read' ? 'seconds' : t === 'review' ? 'count' : null);
const amounts = (a: Partial<DayAmounts>): DayAmounts => ({ ...NO_AMOUNTS, ...a });
const readRow = parseGoalsRow({
	version: 1,
	history: [{ from: '2026-11-01', metric: 'activity:read', target: 2 }]
}) as GoalsRow;

describe('goalDay', () => {
	it('throws for a day after today', () => {
		expect(() => goalDay(readRow, '2026-11-17', '2026-11-16', NO_AMOUNTS, [], units)).toThrow();
	});

	it('is met at exactly target × 60 seconds', () => {
		const at = goalDay(readRow, '2026-11-16', '2026-11-16', amounts({ activity: { read: 120 } }), [], units);
		expect(at.status).toBe('met');
		expect(at.fraction).toBe(1);
		const below = goalDay(readRow, '2026-11-16', '2026-11-16', amounts({ activity: { read: 119 } }), [], units);
		expect(below.status).toBe('open');
		expect(below.amount).toBe(1);
		expect(below.fraction).toBeCloseTo(119 / 120);
	});

	it('caps the fraction at 1 and is 0 for none and vacation', () => {
		expect(goalDay(readRow, '2026-11-16', '2026-11-16', amounts({ activity: { read: 999 } }), [], units).fraction).toBe(1);
		expect(goalDay(null, '2026-11-16', '2026-11-16', amounts({ activity: { read: 999 } }), [], units).fraction).toBe(0);
		const away = goalDay(
			readRow,
			'2026-11-16',
			'2026-11-16',
			amounts({ activity: { read: 999 } }),
			[{ start: '2026-11-16', end: '2026-11-16' }],
			units
		);
		expect(away.status).toBe('vacation');
		expect(away.fraction).toBe(0);
	});
});

describe('goalDays', () => {
	it('is empty when from is after to', () => {
		expect(goalDays(readRow, '2026-11-16', '2026-11-15', '2026-11-16', () => NO_AMOUNTS, [], units)).toEqual([]);
	});
});

// A small deterministic generator (mulberry32).
function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('goalStreak property', () => {
	it('equals a brute-force count over goalDays', () => {
		const today = '2026-11-16';
		for (let seed = 1; seed <= 200; seed++) {
			const r = rng(seed);
			const windowStart = addDays(today, -Math.floor(r() * 30));
			const history: unknown[] = [];
			let day = addDays(today, -40);
			for (let i = 0; i < 4; i++) {
				day = addDays(day, 1 + Math.floor(r() * 12));
				if (day > today) break;
				history.push(
					r() < 0.2
						? { from: day, metric: null, target: null }
						: { from: day, metric: r() < 0.5 ? 'activity:review' : 'flashcards:new', target: 1 + Math.floor(r() * 4) }
				);
			}
			const row = parseGoalsRow({ version: 1, history }) as GoalsRow;
			const table = new Map<string, DayAmounts>();
			for (let d = addDays(today, -45); d <= today; d = addDays(d, 1)) {
				table.set(d, amounts({ activity: { review: Math.floor(r() * 6) }, newCards: Math.floor(r() * 6) }));
			}
			const vacation: Run[] = [];
			if (r() < 0.5) {
				const start = addDays(today, -Math.floor(r() * 20));
				vacation.push({ start, end: addDays(start, Math.floor(r() * 4)) });
			}
			const of = (d: string) => table.get(d) ?? NO_AMOUNTS;

			const days = goalDays(row, windowStart, today, today, of, vacation, units);
			const todayDay = days[days.length - 1];
			let current = 0;
			let broke = false;
			for (let i = days.length - 1; i >= 0; i--) {
				const s = days[i].status;
				if (i === days.length - 1 && s === 'open') continue;
				if (s === 'vacation') continue;
				if (s === 'met') current++;
				else {
					broke = true;
					break;
				}
			}
			if (todayDay.status === 'none') {
				current = 0;
				broke = true;
			}
			const got = goalStreak(row, today, windowStart, of, vacation, units);
			expect(got, `seed ${seed}`).toEqual({
				current,
				todayMet: todayDay.status === 'met' || todayDay.status === 'vacation',
				capped: !broke && current > 0
			});
		}
	});
});
