// The reminder settings (#137): the user-global keyed row `reminders`. Contract and fixtures:
// docs/contracts/reminders/ (settings.json). Parsing is lenient and total; a write re-reads the row first,
// keeps every key it does not know and never overwrites a row written by a newer version.

import { keyedData, type KeyedScope } from '$lib/sync/keyed';

export const REMINDERS_KEY = 'reminders';
export const REMINDER_KINDS = ['due', 'goal', 'streak'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];
export const REMINDER_CHANNELS = ['email', 'push', 'device'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
export const MAX_TIMES = 3;
export const DEFAULT_TIME = '18:00';

export interface QuietHours {
	start: string;
	end: string;
}

export interface ReminderSettings {
	enabled: boolean;
	kinds: Record<ReminderKind, boolean>;
	times: string[];
	/** null: no quiet hours. */
	quiet: QuietHours | null;
	channels: Record<ReminderChannel, boolean>;
}

/** What a caller may change; kinds and channels merge into the stored members. */
export interface ReminderChange {
	enabled?: boolean;
	kinds?: Partial<Record<ReminderKind, boolean>>;
	times?: readonly string[];
	quiet?: QuietHours | null;
	channels?: Partial<Record<ReminderChannel, boolean>>;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validVersion(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export const isTime = (value: unknown): value is string => typeof value === 'string' && TIME.test(value);

export function defaultReminderSettings(): ReminderSettings {
	return {
		enabled: false,
		kinds: { due: true, goal: true, streak: true },
		times: [DEFAULT_TIME],
		quiet: { start: '22:00', end: '08:00' },
		channels: { email: false, push: false, device: false }
	};
}

/** cleanTimes: valid "HH:MM" entries, repeats collapsed, sorted, the first three; none left is the default time. */
export function cleanTimes(list: unknown): string[] {
	if (!Array.isArray(list)) return [DEFAULT_TIME];
	const times = [...new Set(list.filter(isTime))].sort().slice(0, MAX_TIMES);
	return times.length > 0 ? times : [DEFAULT_TIME];
}

function parseQuiet(value: unknown, fallback: QuietHours | null): QuietHours | null {
	if (value === null) return null;
	if (!isRecord(value) || !isTime(value.start) || !isTime(value.end)) return fallback;
	return value.start === value.end ? null : { start: value.start, end: value.end };
}

/** parseReminderSettings reads a stored value (docs/contracts/reminders/README.md "The settings row"). */
export function parseReminderSettings(raw: unknown): ReminderSettings {
	const out = defaultReminderSettings();
	if (!isRecord(raw) || !validVersion(raw.version)) return out;
	out.enabled = raw.enabled === true;
	if (isRecord(raw.kinds)) for (const k of REMINDER_KINDS) out.kinds[k] = typeof raw.kinds[k] === 'boolean' ? raw.kinds[k] : true;
	out.times = cleanTimes(raw.times);
	if ('quiet' in raw) out.quiet = parseQuiet(raw.quiet, out.quiet);
	if (isRecord(raw.channels)) for (const c of REMINDER_CHANNELS) out.channels[c] = raw.channels[c] === true;
	return out;
}

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** inQuietHours: the local time `at` ("HH:MM") is inside the quiet hours (start inclusive, end exclusive, wrapping midnight). */
export function inQuietHours(quiet: QuietHours | null, at: string): boolean {
	if (quiet === null || !isTime(at) || !isTime(quiet.start) || !isTime(quiet.end)) return false;
	const [s, e, m] = [minutes(quiet.start), minutes(quiet.end), minutes(at)];
	if (s === e) return false;
	return s < e ? m >= s && m < e : m >= s || m < e;
}

/**
 * withReminderSettings is the row to write: the stored object with the changed members replaced, every other key
 * kept, `version` kept when it is an integer >= 1 (else 1). A newer version (> 1) is never overwritten: it throws.
 */
export function withReminderSettings(stored: unknown, change: ReminderChange): Record<string, unknown> {
	const base = isRecord(stored) ? stored : {};
	if (validVersion(base.version) && base.version > 1) throw new Error('reminders: the stored row is from a newer version');
	const next: Record<string, unknown> = { ...base, version: validVersion(base.version) ? base.version : 1 };
	if (change.enabled !== undefined) next.enabled = change.enabled;
	if (change.kinds !== undefined) next.kinds = { ...(isRecord(base.kinds) ? base.kinds : {}), ...change.kinds };
	if (change.times !== undefined) next.times = cleanTimes([...change.times]);
	if (change.quiet !== undefined) next.quiet = change.quiet;
	if (change.channels !== undefined) next.channels = { ...(isRecord(base.channels) ? base.channels : {}), ...change.channels };
	return next;
}

type Store = Pick<KeyedScope, 'find' | 'put'>;

/** loadReminderSettings reads the row (no 404 for a never-saved row). Errors reject. */
export async function loadReminderSettings(store: Store = keyedData(null)): Promise<ReminderSettings> {
	return parseReminderSettings(await store.find(REMINDERS_KEY));
}

/** saveReminderSettings re-reads the row, applies the change, writes it and returns what now reads. */
export async function saveReminderSettings(change: ReminderChange, store: Store = keyedData(null)): Promise<ReminderSettings> {
	const next = withReminderSettings(await store.find(REMINDERS_KEY), change);
	await store.put(REMINDERS_KEY, next);
	return parseReminderSettings(next);
}
