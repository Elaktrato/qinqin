// Heatmap aggregation: study events → one count per UTC day. The
// window is the 13 weeks (91 days) the GitHub-style grid renders, so
// the component draws cells straight from the map, including days
// with no events at all.

/** Days covered by the heatmap: 13 weeks of 7 cells. */
export const HEATMAP_DAYS = 91;

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * 91 days ending on `now`'s UTC day, oldest key first. Every day in
 * the window appears in the map — days without events carry 0 — so the
 * heatmap grid needs no gap filling. Events before the window, after
 * today, or with an unparsable timestamp are ignored.
 */
export function aggregateByDay(
	events: { ts: string }[],
	now: Date = new Date()
): Map<string, number> {
	const today = utcDayStart(now);
	const start = today - (HEATMAP_DAYS - 1) * DAY_MS;

	const counts = new Map<string, number>();
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
