import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { studyDay, type StudyDay } from '$lib/time/studyDay';

let day: StudyDay = studyDay([{ zone: 'Asia/Tokyo', from: null }]);
let history = [{ zone: 'Asia/Tokyo', from: null as string | null }];
const listeners = new Set<(d: StudyDay) => void>();

import { contextForData, onContextStale, type StudyDaysView } from './currentContext';

/** The session's StudyDays, faked (record 0009: passed first). */
const days: StudyDaysView = {
	day: () => day,
	effectiveHistory: () => history,
	onChange: (l: (d: StudyDay) => void) => {
		listeners.add(l);
		return () => listeners.delete(l);
	}
};
import type { VacationPeriod } from './vacation';

const period = (over: Partial<VacationPeriod>): VacationPeriod => ({
	version: 1, id: 'A', start: '2026-12-01', end: '2026-12-05', scope: 'all', createdDay: '2026-11-01', createdAt: '2026-11-01T00:00:00Z', ...over
});

describe('contextForData', () => {
	it('gives each workspace its own runs and flags a vacation today', () => {
		const data = { vacations: [period({ scope: { workspaces: [3] } })] };
		const now = Date.parse('2026-12-02T03:00:00Z'); // 12:00 in Tokyo
		expect(contextForData(days, data, 3, now).vacationToday).toBe(true);
		expect(contextForData(days, data, 4, now).vacationToday).toBe(false);
		expect(contextForData(days, data, 3, now).clock.runs).toHaveLength(1);
		expect(contextForData(days, {}, 3, now).clock.runs).toHaveLength(0);
		expect(contextForData(days, data, 3, now).history).toEqual(history);
	});
});

describe('onContextStale', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		day = studyDay([{ zone: 'Asia/Tokyo', from: null }]);
	});
	afterEach(() => {
		vi.useRealTimers();
		listeners.clear();
	});

	it('fires at the learner midnight and again the next one', () => {
		vi.setSystemTime(Date.parse('2026-12-01T14:00:00Z')); // 23:00 Tokyo
		const fn = vi.fn();
		const off = onContextStale(days, fn);
		vi.advanceTimersByTime(59 * 60_000);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(2 * 60_000);
		expect(fn).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(24 * 3_600_000);
		expect(fn).toHaveBeenCalledTimes(2);
		off();
		vi.advanceTimersByTime(48 * 3_600_000);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('fires when the zone changes', () => {
		vi.setSystemTime(Date.parse('2026-12-01T03:00:00Z'));
		const fn = vi.fn();
		const off = onContextStale(days, fn);
		for (const l of listeners) l(day);
		expect(fn).toHaveBeenCalledTimes(1);
		off();
		expect(listeners.size).toBe(0);
	});
});
