// The activity statistics the server aggregates (GET /api/stats/activity).
import { api } from './client';

export interface ActivitySource {
	type: string;
	/** The core feature the activity belongs to (flashcards, reader, journal). */
	feature: string;
	unit: 'count' | 'seconds';
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

/**
 * fetchActivity reads the combined cells of the learner days from..to
 * (YYYY-MM-DD, inclusive), of one workspace when `workspace` is given.
 */
export function fetchActivity(from: string, to: string, workspace?: number): Promise<ActivityResponse> {
	const scope = workspace === undefined ? '' : `&workspace=${encodeURIComponent(String(workspace))}`;
	return api<ActivityResponse>(
		`/api/stats/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${scope}`
	);
}
