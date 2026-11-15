// The learner's time zone history (GET/PUT /api/me/time-zone).
import { api } from './client';
import type { ZoneChange } from '../time/studyDay';

/** The server's body: the current zone (null while none was ever set) and every change. */
export interface TimeZoneResponse {
	zone: string | null;
	history: ZoneChange[];
}

export function getTimeZone(): Promise<TimeZoneResponse> {
	return api<TimeZoneResponse>('/api/me/time-zone');
}

/**
 * putTimeZone records the zone from now on. `ifUnset` makes it the
 * first-run default only: a user who already has a history is not changed.
 */
export function putTimeZone(zone: string, ifUnset = false): Promise<TimeZoneResponse> {
	return api<TimeZoneResponse>('/api/me/time-zone', {
		method: 'PUT',
		body: ifUnset ? { zone, ifUnset: true } : { zone }
	});
}
