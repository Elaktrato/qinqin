import { describe, expect, it } from 'vitest';
import {
	describePeriod,
	errorText,
	periodStatus,
	reviewedTodayIn,
	startNowNote,
	vacationBanner,
	vacationLine,
	vacationStatus
} from './vacationForm';
import type { VacationPeriod } from '$lib/studycore/vacation';
import { studyDay } from '$lib/time/studyDay';

const period = (over: Partial<VacationPeriod> = {}): VacationPeriod => ({
	version: 1, id: 'A', start: '2026-12-03', end: '2026-12-17', scope: 'all', createdDay: '2026-11-15', createdAt: '2026-11-15T08:00:00Z', ...over
});
const spaces = [{ id: 1, name: '中文' }, { id: 2, name: '日本語' }];

describe('describePeriod', () => {
	it('words a closed period', () => {
		expect(describePeriod(period(), '2026-11-15', spaces)).toBe('3 Dec – 17 Dec, all workspaces');
	});
	it('adds the year when it differs from today', () => {
		expect(describePeriod(period({ start: '2026-12-20', end: '2027-01-03' }), '2026-11-15', spaces)).toBe('20 Dec – 3 Jan 2027, all workspaces');
	});
	it('words an open period and a workspace list', () => {
		expect(describePeriod(period({ end: null, scope: { workspaces: [2, 1] } }), '2026-11-15', spaces)).toBe('from 3 Dec until you end it, 中文, 日本語');
	});
	it('names an unknown workspace by its id', () => {
		expect(describePeriod(period({ scope: { workspaces: [9] } }), '2026-11-15', spaces)).toBe('3 Dec – 17 Dec, Workspace 9');
	});
});

describe('periodStatus', () => {
	it('is scheduled before it starts, active while it runs and past after', () => {
		expect(periodStatus(period(), '2026-11-15')).toBe('scheduled');
		expect(periodStatus(period(), '2026-12-03')).toBe('active');
		expect(periodStatus(period(), '2026-12-17')).toBe('active');
		expect(periodStatus(period(), '2026-12-18')).toBe('past');
		expect(periodStatus(period({ end: null }), '2027-05-01')).toBe('active');
	});
	it('applies the createdDay clamp', () => {
		expect(periodStatus(period({ start: '2026-11-01', createdDay: '2026-11-15', end: '2026-11-20' }), '2026-11-15')).toBe('active');
	});
});

describe('vacationBanner', () => {
	it('is empty without a vacation', () => {
		expect(vacationBanner(null, '2026-12-05')).toBeNull();
	});
	it('says until when', () => {
		expect(vacationBanner({ run: { start: '2026-12-03', end: '2027-01-03' }, open: false }, '2026-12-05')).toBe('Vacation until 3 Jan 2027');
		expect(vacationBanner({ run: { start: '2026-12-03', end: '2026-12-17' }, open: false }, '2026-12-05')).toBe('Vacation until 17 Dec');
	});
	it('says when there is no end date', () => {
		expect(vacationBanner({ run: { start: '2026-12-03', end: '2026-12-05' }, open: true }, '2026-12-05')).toBe('On vacation (no end date)');
	});
});

describe('vacationLine', () => {
	it('is the widget wording', () => {
		expect(vacationLine(null, '2026-12-05')).toBeNull();
		expect(vacationLine({ run: { start: '2026-12-03', end: '2027-01-03' }, open: false }, '2026-12-05')).toBe('On vacation until 3 Jan 2027');
		expect(vacationLine({ run: { start: '2026-12-03', end: '2026-12-05' }, open: true }, '2026-12-05')).toBe('On vacation (no end date)');
	});
});

describe('vacationStatus', () => {
	it('finds the run of today and whether an open period holds it', () => {
		const periods = [period({ end: null, start: '2026-12-01', createdDay: '2026-12-01' })];
		expect(vacationStatus(periods, 1, '2026-12-05')).toEqual({ run: { start: '2026-12-01', end: '2026-12-05' }, open: true });
		expect(vacationStatus(periods, 1, '2026-11-20')).toBeNull();
		expect(vacationStatus([period()], 1, '2026-12-05')?.open).toBe(false);
	});
});

describe('startNowNote and errorText', () => {
	it('explains a start tomorrow', () => {
		expect(startNowNote(true)).toBe('Starts tomorrow — you already studied today');
		expect(startNowNote(false)).toBe('');
	});
	it('words every planner error', () => {
		for (const code of ['start-missing', 'end-before-start-tomorrow', 'start-before-today', 'end-before-start', 'too-long', 'no-workspaces', 'started']) {
			expect(errorText(code)).not.toBe(code);
		}
		expect(errorText('???')).toBe('Could not save the vacation.');
	});
});

describe('new error texts', () => {
	it('words the start-tomorrow and missing-start errors', () => {
		expect(errorText('start-missing')).toBe('Choose a start date.');
		expect(errorText('end-before-start-tomorrow')).toMatch(/starts tomorrow because you already studied today/);
	});
});

describe('reviewedTodayIn', () => {
	it('is true for a workspace with a review on the learner day', () => {
		const day = studyDay([{ zone: 'Asia/Tokyo', from: null }]);
		const now = Date.parse('2026-11-16T10:00:00Z');
		const stamps = new Map([[1, [Date.parse('2026-11-15T14:30:00Z')]], [2, [Date.parse('2026-11-15T15:30:00Z')]]]);
		expect(reviewedTodayIn(stamps, day, now)(1)).toBe(false);
		expect(reviewedTodayIn(stamps, day, now)(2)).toBe(true);
		expect(reviewedTodayIn(stamps, day, now)('all')).toBe(true);
	});
});
