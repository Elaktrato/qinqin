// Review heatmap aggregation: review events → one count per UTC day.
// The window is the 13 weeks (91 days) the GitHub-style grid renders,
// so the widget draws cells straight from the map, including days with
// no reviews at all. Only `review` events count; session/view/lookup
// telemetry no longer feeds the home widget.

/** Days covered by the heatmap: 13 weeks of 7 cells. */
export const HEATMAP_DAYS = 91;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The minimum an event needs for day bucketing. */
export interface TimedEvent {
	ts: string;
	type: string;
}

// UTC midnight of a date, in milliseconds. UTC bucketing keeps the
// heatmap identical no matter the viewer's timezone.
function utcDayStart(date: Date): number {
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * aggregateByDay counts `events` per UTC day over a fixed window: the
 * `days` days ending on `now`'s UTC day, oldest key first. Every day in
 * the window appears in the map — days without events carry 0 — so the
 * heatmap grid needs no gap filling. Events before the window, after
 * today, or with an unparsable timestamp are ignored.
 */
export function aggregateByDay(
	events: readonly { ts: string }[],
	now: Date = new Date(),
	days: number = HEATMAP_DAYS
): Map<string, number> {
	const windowDays = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : HEATMAP_DAYS;
	const counts = new Map<string, number>();
	if (windowDays === 0) return counts;

	const today = utcDayStart(now);
	const start = today - (windowDays - 1) * DAY_MS;

	for (let day = start; day <= today; day += DAY_MS) {
		counts.set(dayKey(day), 0);
	}

	for (const event of events) {
		const time = Date.parse(event.ts);
		if (Number.isNaN(time)) continue;

		const day = utcDayStart(new Date(time));
		if (day < start || day > today) continue;

		const key = dayKey(day);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	return counts;
}

/**
 * reviewCountsByDay is the flashcard widget's view of the log: only
 * `review` events are counted, one bucket per UTC day, dense over the
 * last `days` days (default 91). Cards reviewed twice on the same day
 * add two counts; other event types are ignored.
 */
export function reviewCountsByDay(
	events: readonly TimedEvent[],
	now: Date = new Date(),
	days: number = HEATMAP_DAYS
): Map<string, number> {
	return aggregateByDay(
		events.filter((event) => event.type === 'review'),
		now,
		days
	);
}
