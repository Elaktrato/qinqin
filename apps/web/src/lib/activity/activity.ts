// Core activity: one points-per-day view across every learning source
// (flashcard reviews, reading). Pure functions over the event log; the
// home heatmap draws its cells straight from `activityByDay`.

/** Days covered by the heatmap: 13 weeks of 7 cells. */
export const HEATMAP_DAYS = 91;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Seconds of reading that make up one point (5 minutes). */
const SECONDS_PER_POINT = 300;
/** Reading shorter than this earns nothing. */
const MIN_READ_SECONDS = 30;
/** Cap per read event: 24 points = 2 hours. */
const MAX_READ_POINTS = 24;

export interface ActivitySource {
	type: string;
	label: string;
	unit: string;
	points(payload: unknown): number;
	/** Raw amount in the source's own unit: seconds for reading, 1 per review. */
	raw(payload: unknown): number;
	/**
	 * Optional dedupe key: an event whose key was already seen on the same UTC
	 * day adds nothing, and a null key counts 0 points.
	 */
	distinctKey?(payload: unknown): string | null;
	/** Window total in words for the heatmap's aria-label, e.g. "95 minutes of reading". */
	describe(raw: number): string;
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

// Whole minutes for a positive number of seconds, never below 1.
function minutes(seconds: number): number {
	return Math.max(1, Math.round(seconds / 60));
}

/**
 * readingPoints turns a `read` event payload `{seconds}` into points:
 * under 30 s (or not a finite number) is 0, otherwise one point per
 * started 5 minutes, capped at 24 per event.
 */
export function readingPoints(payload: unknown): number {
	if (typeof payload !== 'object' || payload === null) return 0;
	const seconds = (payload as { seconds?: unknown }).seconds;
	if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < MIN_READ_SECONDS) {
		return 0;
	}
	return Math.min(Math.ceil(seconds / SECONDS_PER_POINT), MAX_READ_POINTS);
}

// Seconds a read event contributes, clamped like readingPoints (0 under
// 30 s or when not finite, at most 2 h).
function readingSeconds(payload: unknown): number {
	if (readingPoints(payload) === 0) return 0;
	return Math.min((payload as { seconds: number }).seconds, MAX_READ_POINTS * SECONDS_PER_POINT);
}

// The registry of everything the home heatmap counts. To add a source,
// emit a study event of a new type and add one entry here; unknown
// types are ignored, so nothing counts until it is listed.
export const ACTIVITY_SOURCES: readonly ActivitySource[] = [
	{
		type: 'review',
		label: 'Flashcard reviews',
		unit: 'review(s)',
		points: () => 1,
		raw: () => 1,
		describe: (count) => plural(count, 'flashcard review', 'flashcard reviews')
	},
	{
		type: 'read',
		label: 'Reading',
		unit: 'min',
		points: readingPoints,
		raw: readingSeconds,
		describe: (seconds) => `${plural(minutes(seconds), 'minute', 'minutes')} of reading`
	},
	{
		type: 'journal',
		label: 'Journal entries',
		unit: 'entry(s)',
		points: () => 1,
		raw: () => 1,
		distinctKey: (payload) => {
			const id = (payload as { entryId?: unknown } | null)?.entryId;
			return typeof id === 'string' ? id : null;
		},
		describe: (count) => plural(count, 'journal entry', 'journal entries')
	}
];

export interface DayActivity {
	day: string;
	total: number;
	bySource: Record<string, number>;
	/** Per-source raw amount: summed clamped seconds for read, event count for review. */
	raw: Record<string, number>;
}

function utcDayStart(ms: number): number {
	const date = new Date(ms);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

function windowLength(days: number): number {
	return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : HEATMAP_DAYS;
}

/**
 * windowStart is UTC midnight of the first day `activityByDay` covers,
 * so `GET /api/events?since=` can fetch exactly the window (the
 * server's `since` is an inclusive RFC 3339 bound). An empty window
 * starts today.
 */
export function windowStart(now: Date = new Date(), days: number = HEATMAP_DAYS): Date {
	const windowDays = Math.max(1, windowLength(days));
	return new Date(utcDayStart(now.getTime()) - (windowDays - 1) * DAY_MS);
}

/**
 * activityByDay sums event points per UTC day over the `days` days
 * ending on `now`'s UTC day, oldest first. Every day appears, empty ones
 * with total 0. Unknown types, unparsable timestamps, events outside the
 * window and zero-point events are ignored.
 */
export function activityByDay(
	events: readonly { ts: string; type: string; payload?: unknown }[],
	now: Date = new Date(),
	days: number = HEATMAP_DAYS
): Map<string, DayActivity> {
	const windowDays = windowLength(days);
	const result = new Map<string, DayActivity>();
	if (windowDays === 0) return result;

	const today = utcDayStart(now.getTime());
	const start = windowStart(now, windowDays).getTime();

	for (let day = start; day <= today; day += DAY_MS) {
		const key = dayKey(day);
		result.set(key, { day: key, total: 0, bySource: {}, raw: {} });
	}

	const sources = new Map(ACTIVITY_SOURCES.map((source) => [source.type, source]));
	const seen = new Set<string>();

	for (const event of events) {
		const source = sources.get(event.type);
		if (!source) continue;

		const time = Date.parse(event.ts);
		if (Number.isNaN(time)) continue;

		const day = utcDayStart(time);
		if (day < start || day > today) continue;

		if (source.distinctKey) {
			const key = source.distinctKey(event.payload);
			if (key === null) continue;
			const seenKey = `${source.type}\u0000${day}\u0000${key}`;
			if (seen.has(seenKey)) continue;
			seen.add(seenKey);
		}

		const points = source.points(event.payload);
		if (!(points > 0)) continue;

		const entry = result.get(dayKey(day));
		if (!entry) continue;
		entry.total += points;
		entry.bySource[source.type] = (entry.bySource[source.type] ?? 0) + points;
		entry.raw[source.type] = (entry.raw[source.type] ?? 0) + source.raw(event.payload);
	}

	return result;
}

/** Singularises a plural label such as "Flashcard reviews" for a count of 1. */
function labelFor(source: ActivitySource, count: number): string {
	if (count !== 1) return source.label;
	if (source.label.endsWith('ies')) return `${source.label.slice(0, -3)}y`;
	return source.label.endsWith('s') ? source.label.slice(0, -1) : source.label;
}

/**
 * dayTooltip describes a day, e.g.
 * "2026-11-13: 12 points — 9 Flashcard reviews, 3 Reading (15 min)".
 */
export function dayTooltip(day: DayActivity): string {
	if (day.total <= 0) return `${day.day}: no activity`;

	const parts: string[] = [];
	for (const source of ACTIVITY_SOURCES) {
		const count = day.bySource[source.type];
		if (!count) continue;
		const text = `${count} ${labelFor(source, count)}`;
		parts.push(
			source.type === 'read' ? `${text} (${minutes(day.raw[source.type] ?? 0)} ${source.unit})` : text
		);
	}

	return `${day.day}: ${day.total} ${day.total === 1 ? 'point' : 'points'} — ${parts.join(', ')}`;
}

/**
 * levelFor maps a day's points to a heat level 0..4 by absolute
 * thresholds (0, 1, 2-3, 4-6, 7+): the old flashcards widget's rule,
 * moved unchanged. Levels do not scale with the window's maximum.
 */
export function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
	if (count <= 0) return 0;
	if (count === 1) return 1;
	if (count <= 3) return 2;
	if (count <= 6) return 3;
	return 4;
}

/** Window sums per source (points and raw amount), for aria-labels. */
export function sourceTotals(
	map: Map<string, DayActivity>
): Record<string, { points: number; raw: number }> {
	const totals: Record<string, { points: number; raw: number }> = {};
	for (const entry of map.values()) {
		for (const [type, points] of Object.entries(entry.bySource)) {
			const t = (totals[type] ??= { points: 0, raw: 0 });
			t.points += points;
			t.raw += entry.raw[type] ?? 0;
		}
	}
	return totals;
}

/**
 * windowSummary is the heatmap's aria-label: the window, its total
 * points and each source's total in words, e.g. "Learning activity for
 * the last 13 weeks: 21 points — 2 flashcard reviews, 95 minutes of
 * reading", or "…: no activity yet" for an empty window.
 */
export function windowSummary(map: Map<string, DayActivity>): string {
	const weeks = Math.round(map.size / 7);
	const prefix = `Learning activity for the last ${weeks === 1 ? 'week' : `${weeks} weeks`}`;
	const totals = sourceTotals(map);
	const parts: string[] = [];
	let points = 0;
	for (const source of ACTIVITY_SOURCES) {
		const total = totals[source.type];
		if (!total || total.points <= 0) continue;
		points += total.points;
		parts.push(source.describe(total.raw));
	}
	if (points === 0) return `${prefix}: no activity yet`;
	return `${prefix}: ${plural(points, 'point', 'points')} — ${parts.join(', ')}`;
}
