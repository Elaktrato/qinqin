// The learner's zone, the pure parts: the browser's zone and the per-user
// copy of the zone history in localStorage (for offline starts). The state
// (the loaded history and the StudyDay of now) is the session's StudyDays
// (studyDays.ts, record 0009).

import { unusableZones, type ZoneChange } from './studyDay';

const CACHE_PREFIX = 'qinqin.studyDay.';

function defaultResolve(): string | undefined {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The browser's zone when this runtime can compute with it, else null. */
export function browserZone(resolve: () => string | undefined = defaultResolve): string | null {
	try {
		const zone = resolve();
		if (!zone || zone === 'Etc/Unknown') return null;
		return unusableZones([{ zone, from: null }]).length === 0 ? zone : null;
	} catch {
		return null;
	}
}

function validHistory(value: unknown): value is ZoneChange[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(c, i) =>
				typeof c === 'object' &&
				c !== null &&
				typeof (c as ZoneChange).zone === 'string' &&
				(i === 0 ? (c as ZoneChange).from === null : typeof (c as ZoneChange).from === 'string')
		)
	);
}

/** readZoneCache: this user's stored copy of the zone history, or null. */
export function readZoneCache(storage: Storage | null, id: number): ZoneChange[] | null {
	try {
		const raw = storage?.getItem(CACHE_PREFIX + id);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return validHistory(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function writeZoneCache(storage: Storage | null, id: number, value: ZoneChange[]): void {
	try {
		storage?.setItem(CACHE_PREFIX + id, JSON.stringify(value));
	} catch {
		// Storage is blocked: the in-memory copy still serves this session.
	}
}

export function forgetZoneCache(storage: Storage | null, id: number): void {
	try {
		storage?.removeItem(CACHE_PREFIX + id);
	} catch {
		// Nothing to clear.
	}
}
