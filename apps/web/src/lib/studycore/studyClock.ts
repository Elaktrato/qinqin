// The study clock: elapsed time without vacation days. Whole-day shifts, so
// the UTC time of day (and ts-fsrs's UTC calendar elapsed days) is kept.
// Rule and fixtures: docs/contracts/scheduler/.

import { daysBetweenDates, type StudyDay } from '$lib/time/studyDay';
import type { Run } from './vacation';

const DAY = 86_400_000;

/** A frozen interval: [a, a + n * DAY), `a` in epoch ms. */
export interface ClockRun {
	a: number;
	n: number;
}

export interface StudyClock {
	runs: readonly ClockRun[];
	/** Study time of an instant: real time minus the frozen days before it. */
	v(ms: number): number;
	/** The real instant of a study time (pushes past runs it reaches). */
	inverse(ms: number): number;
}

export function clockFromRuns(runs: readonly ClockRun[]): StudyClock {
	const sorted = [...runs].sort((x, y) => x.a - y.a);
	if (sorted.length === 0) return IDENTITY_CLOCK;
	return {
		runs: sorted,
		v(t) {
			let out = t;
			for (const r of sorted) out -= Math.min(Math.max(t - r.a, 0), r.n * DAY);
			return out;
		},
		inverse(x) {
			let t = x;
			for (const r of sorted) if (t >= r.a) t += r.n * DAY;
			return t;
		}
	};
}

export const IDENTITY_CLOCK: StudyClock = {
	runs: [],
	v: (t) => t,
	inverse: (t) => t
};

export function studyClock(runs: readonly Run[], day: StudyDay): StudyClock {
	return clockFromRuns(
		runs.map((r) => ({ a: day.dayStart(r.start), n: daysBetweenDates(r.start, r.end) + 1 }))
	);
}

/** The instants fed to ts-fsrs: `max(v(ts_i), f_{i-1})`. */
export function feedInstants(tss: readonly number[], clock: StudyClock): number[] {
	const out: number[] = [];
	for (const t of tss) {
		const f = clock.v(t);
		out.push(out.length > 0 && out[out.length - 1] > f ? out[out.length - 1] : f);
	}
	return out;
}
