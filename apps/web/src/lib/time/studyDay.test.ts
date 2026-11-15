import { describe, expect, it } from 'vitest';
import dayOfFixture from '../../../../../docs/contracts/study-day/day-of.json';
import dayStartFixture from '../../../../../docs/contracts/study-day/day-start.json';
import transitions from '../../../../../docs/contracts/study-day/day-of-transitions.json';
import {
	addDays,
	daysBetweenDates,
	isDay,
	studyDay,
	unusableZones,
	type ZoneChange
} from './studyDay';

const h = (...a: [string, string | null][]): ZoneChange[] => a.map(([zone, from]) => ({ zone, from }));
const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');

describe('fixtures: dayOf', () => {
	it('has the documented cases', () => expect(dayOfFixture.cases.length).toBeGreaterThan(30));
	for (const c of dayOfFixture.cases) {
		it(c.name, () => {
			expect(studyDay(c.history as ZoneChange[]).dayOf(ms(c.ts))).toBe(c.day);
		});
	}
});

describe('fixtures: dayStart', () => {
	for (const c of dayStartFixture.cases) {
		it(c.name, () => {
			expect(iso(studyDay(c.history as ZoneChange[]).dayStart(c.day))).toBe(c.start);
		});
	}
});

describe('fixtures: UTC offset transitions 2010-2030', () => {
	it('agrees on every row', () => {
		const rows = transitions.cases as [string, string, string][];
		expect(rows.length).toBeGreaterThan(1000);
		const byZone = new Map<string, ReturnType<typeof studyDay>>();
		const bad: string[] = [];
		for (const [zone, ts, day] of rows) {
			let sd = byZone.get(zone);
			if (!sd) byZone.set(zone, (sd = studyDay(h([zone, null]))));
			const got = sd.dayOf(ms(ts));
			if (got !== day) bad.push(`${zone} ${ts}: ${got} != ${day}`);
		}
		expect(bad).toEqual([]);
	});
	it('agrees when every row is asked cold and in reverse order', () => {
		const rows = (transitions.cases as [string, string, string][]).slice().reverse();
		const sd = new Map<string, ReturnType<typeof studyDay>>();
		for (const [zone, ts, day] of rows) {
			if (!sd.has(zone)) sd.set(zone, studyDay(h([zone, null])));
			expect(sd.get(zone)!.dayOf(ms(ts))).toBe(day);
		}
	});
});

describe('monotone, no repeated date', () => {
	const west = h(['Asia/Tokyo', null], ['America/Los_Angeles', '2026-11-10T16:00:00Z']);
	const trip = h(['Asia/Tokyo', null], ['America/Los_Angeles', '2026-11-10T16:00:00Z'], ['Asia/Tokyo', '2026-11-11T20:00:00Z']);
	const skip = h(['Etc/GMT+12', null], ['Pacific/Kiritimati', '2026-11-10T11:00:00Z']);
	const cases: [string, ZoneChange[], string, string][] = [
		['west', west, '2026-11-05T00:00:00Z', '2026-11-16T00:00:00Z'],
		['round trip', trip, '2026-11-05T00:00:00Z', '2026-11-16T00:00:00Z'],
		['skip', skip, '2026-11-05T00:00:00Z', '2026-11-16T00:00:00Z'],
		['berlin dst', h(['Europe/Berlin', null]), '2025-03-25T00:00:00Z', '2025-11-05T00:00:00Z'],
		['apia', h(['Pacific/Apia', null]), '2011-12-20T00:00:00Z', '2012-01-10T00:00:00Z'],
		['lord howe', h(['Australia/Lord_Howe', null]), '2025-03-25T00:00:00Z', '2025-11-05T00:00:00Z'],
		["st john's clock back across midnight", h(['America/St_Johns', null]), '2010-11-05T00:00:00Z', '2010-11-10T00:00:00Z'],
		['casey 3 h back across midnight', h(['Antarctica/Casey', null]), '2010-03-02T00:00:00Z', '2010-03-08T00:00:00Z']
	];
	for (const [name, hist, from, to] of cases) {
		it(name, () => {
			const sd = studyDay(hist);
			let prev = sd.dayOf(ms(from));
			for (let t = ms(from); t < ms(to); t += 15 * 60_000) {
				const d = sd.dayOf(t);
				expect(d >= prev, `${iso(t)}: ${d} after ${prev}`).toBe(true);
				expect(daysBetweenDates(prev, d)).toBeLessThanOrEqual(3);
				prev = d;
			}
		});
	}
	it("st john's: no repeated date and windows agree with dayOf", () => {
		const sd = studyDay(h(['America/St_Johns', null]));
		const seen: string[] = [];
		for (let t = ms('2010-11-07T02:00:00Z'); t < ms('2010-11-07T05:00:00Z'); t += 60_000) {
			const d = sd.dayOf(t);
			if (seen[seen.length - 1] !== d) seen.push(d);
		}
		expect(seen).toEqual(['2010-11-06', '2010-11-07']);
		expect(iso(sd.dayStart('2010-11-07'))).toBe('2010-11-07T02:30:00Z');
		expect(iso(sd.dayStart('2010-11-08'))).toBe('2010-11-08T03:30:00Z');
	});
	it('the westward long day is one day', () => {
		const sd = studyDay(west);
		const seen = new Set<string>();
		for (let t = ms('2026-11-10T15:00:00Z'); t < ms('2026-11-12T08:00:00Z'); t += 60_000) seen.add(sd.dayOf(t));
		expect([...seen]).toEqual(['2026-11-11']);
	});
});

describe('dayStart and dayOf agree', () => {
	it('every window holds exactly its own day', () => {
		const hists: ZoneChange[][] = [
			h(['Pacific/Apia', null]),
			h(['Europe/Berlin', null]),
			h(['Asia/Tokyo', null], ['America/Los_Angeles', '2026-11-10T16:00:00Z']),
			h(['Europe/Berlin', null], ['Asia/Tokyo', '2026-11-10T12:00:00Z']),
			h(['Etc/GMT+12', null], ['Pacific/Kiritimati', '2026-11-10T11:00:00Z'])
		];
		const starts = ['2011-12-27', '2025-03-28', '2026-11-08', '2026-11-08', '2026-11-08'];
		for (let i = 0; i < hists.length; i++) {
			const sd = studyDay(hists[i]);
			for (let n = 0; n < 7; n++) {
				const day = addDays(starts[i], n);
				const a = sd.dayStart(day);
				const b = sd.dayStart(addDays(day, 1));
				expect(b).toBeGreaterThanOrEqual(a);
				if (b > a) {
					expect(sd.dayOf(a)).toBe(day);
					expect(sd.dayOf(b - 1000)).toBe(day);
					expect(sd.dayOf(b) > day).toBe(true);
					if (a > 0) expect(sd.dayOf(a - 1000) < day).toBe(true);
				}
			}
		}
	});
});

describe('civil arithmetic', () => {
	it.each([
		['2024-02-28', 1, '2024-02-29'],
		['2024-02-29', 1, '2024-03-01'],
		['2023-02-28', 1, '2023-03-01'],
		['2026-01-01', -1, '2025-12-31'],
		['2026-12-31', 1, '2027-01-01'],
		['2026-11-15', 366, '2027-11-16'],
		['2000-02-29', 365, '2001-02-28'],
		['2026-03-29', 1, '2026-03-30']
	] as const)('%s + %i = %s', (day, n, want) => expect(addDays(day, n)).toBe(want));
	it('counts civil days across DST', () => {
		expect(daysBetweenDates('2025-03-29', '2025-03-31')).toBe(2);
		expect(daysBetweenDates('2025-03-31', '2025-03-29')).toBe(-2);
		expect(daysBetweenDates('2024-02-28', '2025-02-28')).toBe(366);
	});
	it('validates days', () => {
		for (const ok of ['2026-11-15', '2024-02-29']) expect(isDay(ok)).toBe(true);
		for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', null, 5, '2026-11-15T00:00:00Z'])
			expect(isDay(bad)).toBe(false);
	});
});

describe('defaults and failure modes', () => {
	it('an empty history is UTC', () => {
		const sd = studyDay([]);
		expect(sd.zone).toBe('UTC');
		expect(sd.dayOf(ms('2026-11-15T23:59:59Z'))).toBe('2026-11-15');
		expect(sd.today(ms('2026-11-16T00:00:00Z'))).toBe('2026-11-16');
	});
	it('the current zone is the last one', () => {
		expect(studyDay(h(['Europe/Berlin', null], ['Asia/Tokyo', '2026-11-10T12:00:00Z'])).zone).toBe('Asia/Tokyo');
	});
	it('an unknown zone runs in UTC for its segment and is listed', () => {
		const hist = h(['Mars/Base', null]);
		expect(unusableZones(hist)).toEqual(['Mars/Base']);
		expect(unusableZones(h(['Europe/Berlin', null]))).toEqual([]);
		const sd = studyDay(hist);
		expect(sd.dayOf(ms('2026-11-15T23:30:00Z'))).toBe('2026-11-15');
		expect(sd.dayStart('2026-11-15')).toBe(ms('2026-11-15T00:00:00Z'));
	});
	it('instants before 1970 are clamped', () => {
		const sd = studyDay(h(['Europe/Berlin', null]));
		expect(sd.dayOf(ms('1900-05-05T00:00:00Z'))).toBe('1970-01-01');
		expect(sd.dayStart('1900-05-05')).toBe(0);
	});
	it('ignores malformed later changes instead of throwing', () => {
		const sd = studyDay([
			{ zone: 'Asia/Tokyo', from: null },
			{ zone: 'Europe/Berlin', from: 'garbage' },
			{ zone: 'Europe/Berlin', from: null }
		]);
		expect(sd.dayOf(ms('2026-11-15T15:30:00Z'))).toBe('2026-11-16');
	});
	it('dayStart results repeat exactly', () => {
		const sd = studyDay(h(['Europe/Berlin', null]));
		const first = sd.dayStart('2025-03-30');
		expect(sd.dayStart('2025-03-30')).toBe(first);
		expect(iso(first)).toBe('2025-03-29T23:00:00Z');
	});
	it('instants with milliseconds stay in their day', () => {
		const sd = studyDay(h(['Asia/Tokyo', null]));
		expect(sd.dayOf(ms('2026-11-15T14:59:59Z') + 999)).toBe('2026-11-15');
		expect(sd.dayOf(ms('2026-11-15T15:00:00Z'))).toBe('2026-11-16');
	});
});
