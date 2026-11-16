import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/scheduler/study-clock.json';
import { studyDay, type ZoneChange } from '../time/studyDay';
import { clockFromRuns, feedInstants, IDENTITY_CLOCK, studyClock } from './studyClock';

const ms = (s: string) => Date.parse(s);
const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
const DAY = 86_400_000;

describe('fixtures: study clock', () => {
	for (const c of fixture.cases) {
		it(c.name, () => {
			const clock = studyClock(c.runs, studyDay(c.history as ZoneChange[]));
			expect(clock.runs.map((r) => ({ a: iso(r.a), n: r.n }))).toEqual(c.clock);
			for (const [t, v] of c.v) expect(iso(clock.v(ms(t)))).toBe(v);
			for (const [x, t] of c.inverse) expect(iso(clock.inverse(ms(x)))).toBe(t);
		});
	}
});

describe('properties', () => {
	let seed = 12345;
	const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	it('holds over random runs and instants', () => {
		for (let k = 0; k < 200; k++) {
			const runs: { a: number; n: number }[] = [];
			let at = 1_700_000_000_000 + Math.floor(rnd() * 50) * DAY;
			for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) {
				const n = 1 + Math.floor(rnd() * 10);
				runs.push({ a: at, n });
				at += (n + 1 + Math.floor(rnd() * 20)) * DAY;
			}
			const clock = clockFromRuns(runs);
			let prev = -Infinity;
			for (let j = 0; j < 40; j++) {
				const t = 1_700_000_000_000 - 5 * DAY + Math.floor(rnd() * 200 * DAY);
				const x = clock.v(t);
				expect(clock.v(clock.inverse(x))).toBe(x);
				const inside = runs.some((r) => t >= r.a && t < r.a + r.n * DAY);
				if (!inside) expect(clock.inverse(x)).toBe(t);
				void prev;
			}
			const ts = Array.from({ length: 30 }, () => 1_700_000_000_000 + Math.floor(rnd() * 200 * DAY)).sort((p, q) => p - q);
			const fed = ts.map((t) => clock.v(t));
			for (let i = 1; i < fed.length; i++) expect(fed[i]).toBeGreaterThanOrEqual(fed[i - 1]);
		}
	});
	it('is the identity without runs', () => {
		expect(IDENTITY_CLOCK.v(123456)).toBe(123456);
		expect(IDENTITY_CLOCK.inverse(123456)).toBe(123456);
	});
});

describe('feedInstants', () => {
	it('is non-decreasing even for unsorted input', () => {
		expect(feedInstants([5, 3, 9], IDENTITY_CLOCK)).toEqual([5, 5, 9]);
	});
	it('maps through v', () => {
		const clock = clockFromRuns([{ a: 100 * DAY, n: 2 }]);
		expect(feedInstants([99 * DAY, 101 * DAY, 103 * DAY], clock)).toEqual([99 * DAY, 100 * DAY, 101 * DAY]);
	});
});
