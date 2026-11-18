import { afterEach, describe, expect, it } from 'vitest';
import type { ActivitySource } from '../api/stats';
import type { CountRow, WeekDay, WeekSummary } from './summary';
import {
	compareText,
	compareWindowText,
	dayName,
	dayShort,
	daysActiveText,
	goalText,
	rowLabel,
	rowValue,
	streakText,
	offlineText,
	summaryLines,
	weekHeading
} from './weekText';

const L = 'en-GB';
const drill: ActivitySource = {
	type: 'drill',
	plugin: 'grammar-drills',
	label: 'Grammar drills',
	unit: 'count',
	describe: { one: '{n} drill', other: '{n} drills' }
};

// ICU versions differ in the spaces around a range's dash (none, thin, normal).
const norm = (text: string) => text.replace(/\s*–\s*/gu, '–');

describe('weekHeading', () => {
	it('names this week, last week and older weeks', () => {
		expect(norm(weekHeading('2026-11-16', '2026-11-18', L))).toBe('This week (16–22 November 2026)');
		expect(norm(weekHeading('2026-11-09', '2026-11-18', L))).toBe('Last week (9–15 November 2026)');
		expect(norm(weekHeading('2026-11-02', '2026-11-18', L))).toBe('Week of 2–8 November 2026');
	});

	it('spans months and years', () => {
		expect(norm(weekHeading('2026-11-30', '2027-02-01', L))).toBe('Week of 30 November–6 December 2026');
		expect(norm(weekHeading('2026-12-28', '2027-02-01', L))).toBe('Week of 28 December 2026–3 January 2027');
	});

	describe('never shifted by the device zone', () => {
		const saved = process.env.TZ;
		afterEach(() => {
			process.env.TZ = saved;
		});
		it.each(['Pacific/Kiritimati', 'America/Adak'])('%s', (zone) => {
			process.env.TZ = zone;
			expect(norm(weekHeading('2026-11-16', '2026-11-18', L))).toBe('This week (16–22 November 2026)');
			expect(dayName({ date: '2026-11-16', state: 'inactive', reviews: 0, points: 0 }, L)).toBe(
				'Monday 16 November: not active'
			);
			expect(dayShort('2026-11-22', L)).toBe('Sun');
		});
	});
});

describe('compareText', () => {
	it('counts', () => {
		expect(compareText(20, 8, 'count')).toBe('12 more than last week');
		expect(compareText(5, 8, 'count')).toBe('3 fewer than last week');
		expect(compareText(2, 1, 'count')).toBe('1 more than last week');
		expect(compareText(4, 4, 'count')).toBe('Same as last week');
	});

	it('compares seconds in whole minutes as shown', () => {
		expect(compareText(3900, 0, 'seconds')).toBe('1 h 05 min more than last week');
		expect(compareText(60, 360, 'seconds')).toBe('5 min less than last week');
		expect(compareText(130, 150, 'seconds')).toBe('Same as last week');
	});

	it('names the week before for a browsed past week', () => {
		expect(compareText(20, 8, 'count', false)).toBe('12 more than the week before');
		expect(compareText(5, 8, 'count', false)).toBe('3 fewer than the week before');
		expect(compareText(4, 4, 'count', false)).toBe('Same as the week before');
		expect(compareText(3900, 0, 'seconds', false)).toBe('1 h 05 min more than the week before');
		expect(compareText(60, 360, 'seconds', false)).toBe('5 min less than the week before');
	});
});

describe('compareWindowText', () => {
	const s = (inProgress: boolean, today: string, nothingToCompare = false) =>
		({ inProgress, today, nothingToCompare }) as WeekSummary;
	it('names the same-weekday window of the week in progress', () => {
		expect(compareWindowText(s(true, '2026-11-18'), L)).toBe('Compared with Monday to Wednesday last week');
		expect(compareWindowText(s(true, '2026-11-16'), L)).toBe('Compared with Monday last week');
		expect(compareWindowText(s(true, '2026-11-22'), L)).toBe('Compared with last week');
		expect(compareWindowText(s(false, '2026-11-18'), L)).toBe('Compared with the week before');
		expect(compareWindowText(s(false, '2026-11-18', true), L)).toBe(
			'Nothing in the week before to compare'
		);
		expect(compareWindowText(s(true, '2026-11-18', true), L)).toBe('Nothing last week to compare');
	});
});

describe('rows', () => {
	const row = (key: CountRow['key'], value: number | null, unit: CountRow['unit'] = 'count'): CountRow => ({
		key,
		value,
		previous: 0,
		unit
	});
	it('labels the built-in rows and the plugin sources', () => {
		expect(rowLabel(row('reviews', 1), [])).toBe('Reviews');
		expect(rowLabel(row('newCards', 1), [])).toBe('New cards');
		expect(rowLabel(row('studyTime', 1), [])).toBe('Flashcard study time');
		expect(rowLabel(row('reading', 1), [])).toBe('Reading');
		expect(rowLabel(row('journal', 1), [])).toBe('Journal entries');
		expect(rowLabel(row('activity:drill', 1), [drill])).toBe('Grammar drills');
		expect(rowLabel(row('activity:gone', 1), [drill])).toBe('gone');
	});

	it('formats values', () => {
		expect(rowValue(row('reviews', 1234))).toBe('1234');
		expect(rowValue(row('studyTime', 3900, 'seconds'))).toBe('1 h 05 min');
		expect(rowValue(row('reviews', null))).toBe('Not available offline');
	});
});

describe('days', () => {
	const day = (state: WeekDay['state'], reviews: number | null = 0): WeekDay => ({
		date: '2026-11-16',
		state,
		reviews,
		points: reviews
	});
	it('names every state', () => {
		expect(dayName(day('active', 42), L)).toBe('Monday 16 November: active, 42 reviews');
		expect(dayName(day('active', 1), L)).toBe('Monday 16 November: active, 1 review');
		expect(dayName(day('active', 0), L)).toBe('Monday 16 November: active');
		expect(dayName(day('active', null), L)).toBe('Monday 16 November: active');
		expect(dayName(day('inactive'), L)).toBe('Monday 16 November: not active');
		expect(dayName(day('vacation', 5), L)).toBe('Monday 16 November: vacation, 5 reviews');
		expect(dayName(day('vacation'), L)).toBe('Monday 16 November: vacation');
		expect(dayName(day('upcoming', null), L)).toBe('Monday 16 November: upcoming');
		expect(dayName(day('skipped'), L)).toBe('Monday 16 November: no such day');
	});

	it('counts the days active', () => {
		expect(daysActiveText({ active: 4, of: 5, localOnly: false }, false)).toBe('Active on 4 of 5 days');
		expect(daysActiveText({ active: 3, of: 3, localOnly: false }, true)).toBe('Active on 3 of 3 days so far');
		expect(daysActiveText({ active: 1, of: 1, localOnly: true }, true)).toBe(
			'Active on 1 of 1 day so far (from flashcard reviews only)'
		);
		expect(daysActiveText({ active: 0, of: 0, localOnly: false }, false)).toBe('No days to count');
	});
});

describe('streak and goal', () => {
	it('words the streak for the week in progress and a past week', () => {
		expect(streakText(4, true)).toBe('Study streak: 4 days');
		expect(streakText(1, true)).toBe('Study streak: 1 day');
		expect(streakText(0, true)).toBe('Study streak: 0 days');
		expect(streakText(4, false)).toBe('Study streak at the end of the week: 4 days');
	});

	it('words the goal days', () => {
		expect(goalText({ met: 2, of: 6 }, false)).toBe('Daily goal met on 2 of 6 days');
		expect(goalText({ met: 1, of: 1 }, true)).toBe('Daily goal met on 1 of 1 day so far');
		expect(goalText({ met: 0, of: 0 }, false)).toBe('No goal days to count');
	});
});

describe('summaryLines', () => {
	const summary = (over: Partial<WeekSummary> = {}): WeekSummary => ({
		monday: '2026-11-09',
		today: '2026-11-18',
		inProgress: false,
		compareThrough: '2026-11-08',
		rows: [
			{ key: 'reviews', value: 15, previous: 8, unit: 'count' },
			{ key: 'newCards', value: 2, previous: 2, unit: 'count' },
			{ key: 'studyTime', value: 120, previous: 60, unit: 'seconds' },
			{ key: 'reading', value: 600, previous: 900, unit: 'seconds' },
			{ key: 'journal', value: 1, previous: 0, unit: 'count' },
			{ key: 'activity:drill', value: 4, previous: 0, unit: 'count' }
		],
		days: [],
		previousDays: [],
		daysActive: { active: 5, of: 7, localOnly: false },
		streak: 3,
		mature: { value: 2, previous: 1 },
		characters: null,
		goal: { met: 2, of: 6 },
		allVacation: false,
		nothingToCompare: false,
		...over
	});

	it('lists every row in order with its comparison', () => {
		const lines = summaryLines(summary(), [drill], { value: 3, previous: 5 }, false);
		expect(lines.map((l) => l.term)).toEqual([
			'Reviews',
			'New cards',
			'Flashcard study time',
			'Reading',
			'Journal entries',
			'Grammar drills',
			'Days active',
			'Streak',
			'Words reaching mature',
			'Characters learned',
			'Daily goal'
		]);
		expect(lines[0]).toEqual({ id: 'reviews', term: 'Reviews', value: '15', comparison: '7 more than the week before', trend: 'up' });
		expect(lines[1].trend).toBe('same');
		expect(lines[3]).toMatchObject({ value: '10 min', comparison: '5 min less than the week before', trend: 'down' });
		expect(lines[6]).toMatchObject({ value: 'Active on 5 of 7 days', comparison: null, trend: null });
		expect(lines[7].value).toBe('Study streak at the end of the week: 3 days');
		expect(lines[8]).toMatchObject({ value: '2', comparison: '1 more than the week before' });
		expect(lines[9]).toMatchObject({ value: '3', comparison: '2 fewer than the week before' });
		expect(lines[10]).toMatchObject({ value: 'Daily goal met on 2 of 6 days', comparison: null });
	});

	it('leaves out comparisons with nothing to compare or offline', () => {
		const offline = summary({
			nothingToCompare: true,
			rows: [{ key: 'reviews', value: null, previous: null, unit: 'count' }]
		});
		const lines = summaryLines(offline, [], null, false);
		expect(lines[0]).toMatchObject({ value: 'Not available offline', comparison: null, trend: null });
		expect(lines.find((l) => l.id === 'mature')?.comparison).toBeNull();
		expect(lines.some((l) => l.id === 'characters')).toBe(false);
	});

	it('shows the pending characters row', () => {
		expect(summaryLines(summary(), [], 'pending', false).find((l) => l.id === 'characters')).toMatchObject({
			value: 'Counting characters…',
			comparison: null
		});
	});

	it('compact: reviews, new cards, study time with reading, days active and streak', () => {
		const lines = summaryLines(summary({ inProgress: true }), [drill], { value: 1, previous: 0 }, true);
		expect(lines.map((l) => l.id)).toEqual(['reviews', 'newCards', 'time', 'daysActive', 'streak']);
		expect(lines[2]).toMatchObject({ term: 'Study time', value: '12 min', comparison: '4 min less than last week' });
		const offline = summary({
			rows: summary().rows.map((r) => (r.key === 'reading' ? { ...r, value: null, previous: null } : r))
		});
		expect(summaryLines(offline, [], null, true)[2]).toMatchObject({ value: '2 min (flashcards only)', comparison: null, trend: null });
	});
});

describe('characters unavailable', () => {
	it('keeps the row with the offline text', () => {
		const s = {
			monday: '2026-11-09', today: '2026-11-18', inProgress: false, compareThrough: '2026-11-08', rows: [], days: [], previousDays: [],
			daysActive: { active: 0, of: 7, localOnly: false }, streak: 0, mature: null, characters: null, goal: null,
			allVacation: false, nothingToCompare: false
		} as WeekSummary;
		expect(summaryLines(s, [], 'unavailable', false).find((l) => l.id === 'characters')).toEqual({
			id: 'characters', term: 'Characters learned', value: 'Not available offline', comparison: null, trend: null
		});
	});

	it('says what is missing offline', () => {
		expect(offlineText(true, false)).toBe('Reviews, reading and journal numbers are not available offline.');
		expect(offlineText(false, true)).toBe('Characters learned is not available offline.');
		expect(offlineText(true, true)).toBe('Reviews, reading, journal and character numbers are not available offline.');
		expect(offlineText(false, false)).toBeNull();
	});
});
