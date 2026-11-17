// Tracked reading time, derived from the reader's `read` events
// (payload `{ bookId, seconds }`). The reader posts a burst only when it
// lasted at least 30 s, and each event counts with the same clamping as
// the heatmap's reading points (readingPoints below): nothing under
// 30 s or when not a finite number, at most 2 hours per event.

import { t } from '../i18n';
import { addDays, type StudyDay } from '../time/studyDay';

/** Seconds of reading that make up one point (5 minutes). */
const SECONDS_PER_POINT = 300;
/** Reading shorter than this earns nothing. */
const MIN_READ_SECONDS = 30;
/** Cap per read event: 24 points = 2 hours. */
const MAX_READ_POINTS = 24;

/**
 * readingPoints turns a `read` event payload `{seconds}` into points:
 * under 30 s (or not a finite number) is 0, otherwise one point per
 * started 5 minutes, capped at 24 per event. The server scores the
 * heatmap with the same rule (the reader manifest's activity rule);
 * this copy only clamps the reading-time totals.
 */
export function readingPoints(payload: unknown): number {
	if (typeof payload !== 'object' || payload === null) return 0;
	const seconds = (payload as { seconds?: unknown }).seconds;
	if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < MIN_READ_SECONDS) {
		return 0;
	}
	return Math.min(Math.ceil(seconds / SECONDS_PER_POINT), MAX_READ_POINTS);
}

/** The per-event cap: the 24 points × 5 minutes readingPoints allows. */
export const MAX_READ_SECONDS = 2 * 60 * 60;

export interface BookTime {
	/** null when the event carried no usable book id. */
	bookId: number | null;
	seconds: number;
}

export interface ReadingTotals {
	totalSeconds: number;
	/** Today (the learner's day) and the 6 days before. */
	last7Seconds: number;
	/** Today (the learner's day) and the 29 days before. */
	last30Seconds: number;
	/** Per book, most read first (ties by book id, unknown last). */
	books: BookTime[];
}

export interface TopBook {
	key: string;
	title: string;
	seconds: number;
	/** The book is no longer in the library (or its id was unusable). */
	removed: boolean;
}

/** readSeconds is the seconds one read payload counts, clamped like readingPoints. */
export function readSeconds(payload: unknown): number {
	if (readingPoints(payload) === 0) return 0;
	return Math.min((payload as { seconds: number }).seconds, MAX_READ_SECONDS);
}

function bookIdOf(payload: unknown): number | null {
	const id = (payload as { bookId?: unknown } | null)?.bookId;
	return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * readingTotals sums the read events: all time, the last 7 and 30
 * learner days (each ending with today, `day.today(now)`), and per book. Other event types,
 * unparsable timestamps and payloads worth 0 s are ignored. An event
 * dated after today (a fast device clock) counts in the total only.
 */
export function readingTotals(
	events: readonly { ts: string; type: string; payload?: unknown }[],
	now: Date,
	day: StudyDay
): ReadingTotals {
	const today = day.today(now.getTime());
	const start7 = addDays(today, -6);
	const start30 = addDays(today, -29);
	const perBook = new Map<number | null, number>();
	let totalSeconds = 0;
	let last7Seconds = 0;
	let last30Seconds = 0;

	for (const event of events) {
		if (event.type !== 'read') continue;
		const time = Date.parse(event.ts);
		if (Number.isNaN(time)) continue;
		const seconds = readSeconds(event.payload);
		if (seconds <= 0) continue;

		totalSeconds += seconds;
		const eventDay = day.dayOf(time);
		if (eventDay <= today && eventDay >= start30) {
			last30Seconds += seconds;
			if (eventDay >= start7) last7Seconds += seconds;
		}
		const book = bookIdOf(event.payload);
		perBook.set(book, (perBook.get(book) ?? 0) + seconds);
	}

	const books = [...perBook.entries()]
		.map(([bookId, seconds]) => ({ bookId, seconds }))
		.sort(
			(a, b) =>
				b.seconds - a.seconds ||
				(a.bookId ?? Number.POSITIVE_INFINITY) - (b.bookId ?? Number.POSITIVE_INFINITY)
		);

	return { totalSeconds, last7Seconds, last30Seconds, books };
}

/**
 * topBooks names the `limit` most read books. `titles` maps book ids to
 * titles from the library; a book not in it was removed. With `titles`
 * null (the library could not be loaded) books are numbered instead.
 */
export function topBooks(
	books: readonly BookTime[],
	titles: ReadonlyMap<number, string> | null,
	limit = 5
): TopBook[] {
	return books.slice(0, limit).map(({ bookId, seconds }) => {
		const key = bookId === null ? 'unknown' : String(bookId);
		if (bookId !== null && titles === null) {
			return { key, title: t('stats.reading.bookN', { id: bookId }), seconds, removed: false };
		}
		const title = bookId === null ? undefined : titles?.get(bookId);
		if (title === undefined) return { key, title: t('stats.reading.removedBook'), seconds, removed: true };
		return { key, title: title.trim() || t('stats.reading.untitled'), seconds, removed: false };
	});
}

/** formatDuration writes seconds as "1 h 05 min", "12 min" or "< 1 min". */
export function formatDuration(seconds: number): string {
	const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
	if (value === 0) return t('stats.duration.zero');
	if (value < 60) return t('stats.duration.underMinute', { less: '<' });
	const minutes = Math.floor(value / 60);
	if (minutes < 60) return t('stats.duration.minutes', { minutes });
	const hours = Math.floor(minutes / 60);
	return t('stats.duration.hours', { hours, minutes: String(minutes % 60).padStart(2, '0') });
}
