// The activity statistics the server aggregates (GET /api/stats/activity).
import { api } from './client';

export interface ActivitySource {
	type: string;
	plugin: string;
	label: string;
	unit: 'count' | 'seconds';
	describe: { one: string; other: string };
}

/** One learner day (the user's time zone, lib/time/studyDay.ts) of one workspace and activity type. */
export interface ActivityCell {
	day: string;
	workspace: number;
	type: string;
	points: number;
	raw: number;
}

export interface ActivityResponse {
	from: string;
	to: string;
	/** The user's current zone (UTC while none is set). */
	timeZone: string;
	sources: ActivitySource[];
	cells: ActivityCell[];
}

/** fetchActivity reads the combined cells of the learner days from..to (YYYY-MM-DD, inclusive). */
export function fetchActivity(from: string, to: string): Promise<ActivityResponse> {
	return api<ActivityResponse>(
		`/api/stats/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
	);
}
