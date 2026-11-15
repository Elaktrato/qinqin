import { describe, expect, it } from 'vitest';

import {
	MAX_READ_SECONDS,
	formatDuration,
	readSeconds,
	readingPoints,
	readingTotals,
	topBooks
} from './readingTime';

const NOW = new Date('2026-11-14T12:00:00.000Z');

function read(ts: string, seconds: unknown, bookId: unknown = 1) {
	return { ts, type: 'read', payload: { bookId, seconds } };
}

describe('readSeconds', () => {
	it('clamps like readingPoints: nothing under 30 s or when not finite, at most 2 h', () => {
		expect(readSeconds({ seconds: 29 })).toBe(0);
		expect(readSeconds({ seconds: 30 })).toBe(30);
		expect(readSeconds({ seconds: Number.NaN })).toBe(0);
		expect(readSeconds({ seconds: Number.POSITIVE_INFINITY })).toBe(0);
		expect(readSeconds({ seconds: '600' })).toBe(0);
		expect(readSeconds(null)).toBe(0);
		expect(readSeconds({})).toBe(0);
		expect(readSeconds({ seconds: 99999 })).toBe(MAX_READ_SECONDS);
	});

	it('caps at the same 2 hours as the heatmap points', () => {
		expect(MAX_READ_SECONDS).toBe(7200);
		expect(readingPoints({ seconds: MAX_READ_SECONDS })).toBe(readingPoints({ seconds: 1e9 }));
	});
});

describe('readingTotals', () => {
	it('is zero for no events', () => {
		expect(readingTotals([], NOW)).toEqual({
			totalSeconds: 0,
			last7Seconds: 0,
			last30Seconds: 0,
			books: []
		});
	});

	it('sums read events only, ignoring other types and bad timestamps', () => {
		const events = [
			read('2026-11-14T08:00:00.000Z', 600),
			{ ts: '2026-11-14T08:00:00.000Z', type: 'review', payload: { seconds: 600 } },
			read('not a date', 600)
		];
		expect(readingTotals(events, NOW).totalSeconds).toBe(600);
	});

	it('windows by UTC day: 7 days = today and the 6 days before', () => {
		const events = [
			read('2026-11-14T23:59:59.000Z', 60), // today (later than now, same UTC day)
			read('2026-11-08T00:00:00.000Z', 120), // 6 days back: in
			read('2026-11-07T23:59:59.999Z', 240), // 7 days back: out of 7, in 30
			read('2026-10-16T00:00:00.000Z', 480), // 29 days back: in 30
			read('2026-10-15T23:59:59.999Z', 960) // 30 days back: out
		];
		const totals = readingTotals(events, NOW);
		expect(totals.last7Seconds).toBe(180);
		expect(totals.last30Seconds).toBe(900);
		expect(totals.totalSeconds).toBe(1860);
	});

	it('keeps an event of a later UTC day out of the windows but in the total', () => {
		const totals = readingTotals([read('2026-11-15T00:00:00.000Z', 60)], NOW);
		expect(totals.last7Seconds).toBe(0);
		expect(totals.totalSeconds).toBe(60);
	});

	it('groups per book, most read first, unknown book ids as null', () => {
		const events = [
			read('2026-11-01T00:00:00.000Z', 100, 1),
			read('2026-11-02T00:00:00.000Z', 300, 2),
			read('2026-11-03T00:00:00.000Z', 150, 1),
			read('2026-11-03T00:00:00.000Z', 40, 'x'),
			read('2026-11-03T00:00:00.000Z', 10, 3) // under 30 s: not counted at all
		];
		expect(readingTotals(events, NOW).books).toEqual([
			{ bookId: 2, seconds: 300 },
			{ bookId: 1, seconds: 250 },
			{ bookId: null, seconds: 40 }
		]);
	});

	it('breaks per-book ties by book id', () => {
		const events = [read('2026-11-01T00:00:00.000Z', 60, 9), read('2026-11-01T00:00:00.000Z', 60, 4)];
		expect(readingTotals(events, NOW).books.map((b) => b.bookId)).toEqual([4, 9]);
	});
});

describe('topBooks', () => {
	const books = [
		{ bookId: 1, seconds: 500 },
		{ bookId: 2, seconds: 400 },
		{ bookId: null, seconds: 300 },
		{ bookId: 3, seconds: 200 },
		{ bookId: 4, seconds: 100 },
		{ bookId: 5, seconds: 50 }
	];

	it('names the top five, a missing book as removed', () => {
		const titles = new Map([
			[1, '吾輩は猫である'],
			[2, '三国演义'],
			[4, 'Book four'],
			[5, 'Book five']
		]);
		expect(topBooks(books, titles)).toEqual([
			{ key: '1', title: '吾輩は猫である', seconds: 500, removed: false },
			{ key: '2', title: '三国演义', seconds: 400, removed: false },
			{ key: 'unknown', title: 'A removed book', seconds: 300, removed: true },
			{ key: '3', title: 'A removed book', seconds: 200, removed: true },
			{ key: '4', title: 'Book four', seconds: 100, removed: false }
		]);
	});

	it('falls back to a numbered label when the titles could not be loaded', () => {
		expect(topBooks(books.slice(0, 1), null)).toEqual([
			{ key: '1', title: 'Book 1', seconds: 500, removed: false }
		]);
	});

	it('uses the untitled label for a blank title', () => {
		expect(topBooks(books.slice(0, 1), new Map([[1, '  ']]))[0].title).toBe('Untitled book');
	});
});

describe('formatDuration', () => {
	it('formats minutes and hours', () => {
		expect(formatDuration(0)).toBe('0 min');
		expect(formatDuration(1)).toBe('< 1 min');
		expect(formatDuration(59)).toBe('< 1 min');
		expect(formatDuration(60)).toBe('1 min');
		expect(formatDuration(12 * 60 + 59)).toBe('12 min');
		expect(formatDuration(3599)).toBe('59 min');
		expect(formatDuration(3600)).toBe('1 h 00 min');
		expect(formatDuration(3600 + 5 * 60)).toBe('1 h 05 min');
		expect(formatDuration(26 * 3600 + 42 * 60)).toBe('26 h 42 min');
	});

	it('treats negative or non-finite input as zero', () => {
		expect(formatDuration(-5)).toBe('0 min');
		expect(formatDuration(Number.NaN)).toBe('0 min');
	});
});
