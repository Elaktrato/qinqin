// Loads and keeps the learner's zone history (the server's copy, mirrored
// in localStorage for offline starts) and exposes the StudyDay every
// "day" consumer uses. Lookup order for currentStudyDay(): the loaded
// history, the cached copy of this user, the browser's own zone
// (provisional, until the load finishes), UTC.

import { onSessionEnd } from '../session/sessionEnd';
import { getTimeZone, putTimeZone, type TimeZoneResponse } from '../api/timeZone';
import { studyDay, unusableZones, type StudyDay, type ZoneChange } from './studyDay';

const CACHE_PREFIX = 'qinqin.studyDay.';

let userId: number | null = null;
// Bumped whenever the signed-in user changes or is cleared: a response
// that was requested under an older epoch belongs to someone else.
let epoch = 0;
let pending: Promise<unknown> | null = null;
let history: ZoneChange[] | null = null;
let current: StudyDay | null = null;
const listeners = new Set<(day: StudyDay) => void>();
onSessionEnd(() => clearStudyDay());

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

function readCache(id: number): ZoneChange[] | null {
	try {
		const raw = localStorage.getItem(CACHE_PREFIX + id);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return validHistory(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function writeCache(id: number, value: ZoneChange[]): void {
	try {
		localStorage.setItem(CACHE_PREFIX + id, JSON.stringify(value));
	} catch {
		// Storage is blocked: the in-memory copy still serves this session.
	}
}

function set(next: ZoneChange[] | null): StudyDay {
	history = next;
	current = null;
	const day = currentStudyDay();
	for (const listener of [...listeners]) listener(day);
	return day;
}

/** currentStudyDay: the loaded history > this user's cached copy > the browser zone > UTC. */
export function currentStudyDay(): StudyDay {
	if (current) return current;
	current = studyDay(effectiveHistory());
	return current;
}

function effectiveHistory(): ZoneChange[] {
	let source: ZoneChange[] | null = history;
	if (!source && userId !== null) source = readCache(userId);
	if (!source) {
		const zone = browserZone();
		source = zone ? [{ zone, from: null }] : [];
	}
	return source;
}

/** The zone history behind currentStudyDay() (serialisable, for workers). */
export function currentStudyHistory(): ZoneChange[] {
	return effectiveHistory();
}

function adopt(id: number, body: TimeZoneResponse): StudyDay {
	if (body.history.length > 0) writeCache(id, body.history);
	return set(body.history.length > 0 ? body.history : null);
}

function resetUser(next: number | null): void {
	epoch++;
	userId = next;
	history = null;
	current = null;
}

/**
 * ensureStudyDay loads the history of the signed-in user. An empty
 * server history plus a usable browser zone sends the browser zone once
 * with `ifUnset` (a second device never turns that into a change). It
 * never rejects: offline, the cached copy (or the provisional browser
 * zone) stays in effect. A response that arrives after the user signed
 * out or another user signed in is dropped.
 */
export async function ensureStudyDay(forUser: number): Promise<StudyDay> {
	if (userId !== forUser) resetUser(forUser);
	const mine = epoch;
	const cached = history ?? readCache(forUser);
	if (cached && !history) set(cached);
	const run = (async (): Promise<StudyDay> => {
		try {
			let body = await getTimeZone();
			if (mine !== epoch) return currentStudyDay();
			if (body.history.length === 0) {
				const zone = browserZone();
				if (zone) {
					body = await putTimeZone(zone, true);
					if (mine !== epoch) return currentStudyDay();
				}
			}
			return adopt(forUser, body);
		} catch {
			return currentStudyDay();
		}
	})();
	pending = run;
	void run.finally(() => {
		if (pending === run) pending = null;
	});
	return run;
}

/**
 * syncStudyDayUser follows the signed-in user: null (signed out) forgets
 * the in-memory history, a new or returning user loads theirs once.
 */
export function syncStudyDayUser(id: number | null): Promise<StudyDay> | null {
	if (id === null) {
		resetUser(null);
		return null;
	}
	if (id === userId && (history !== null || pending !== null)) return pending ? (pending as Promise<StudyDay>) : Promise.resolve(currentStudyDay());
	return ensureStudyDay(id);
}

/** whenStudyDaySettled resolves once the load in flight (if any) has finished. */
export async function whenStudyDaySettled(): Promise<void> {
	while (pending) await pending.catch(() => undefined);
}

/** changeZone makes `zone` the learner's zone from now on and returns the new rule. */
export async function changeZone(zone: string): Promise<StudyDay> {
	const mine = epoch;
	const forUser = userId;
	const body = await putTimeZone(zone);
	if (mine !== epoch) return currentStudyDay();
	if (forUser !== null) return adopt(forUser, body);
	return set(body.history.length > 0 ? body.history : null);
}

/** The history in effect, `[]` until one is known (the Settings page reads it). */
export function currentHistory(): readonly ZoneChange[] {
	if (history) return history;
	return userId !== null ? (readCache(userId) ?? []) : [];
}

export function onStudyDayChange(listener: (day: StudyDay) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** clearStudyDay (logout): memory and this user's stored copy. */
export function clearStudyDay(): void {
	if (userId !== null) {
		try {
			localStorage.removeItem(CACHE_PREFIX + userId);
		} catch {
			// Nothing to clear.
		}
	}
	resetUser(null);
}
