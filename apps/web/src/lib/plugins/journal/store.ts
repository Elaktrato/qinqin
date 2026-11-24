import type { EventLog } from '$lib/events';
// The journal's documents (docs/contracts/journal/): entries, reviews, topic
// ideas and settings of one workspace, through /api/journal/*. Every answer
// is decoded here; a malformed one reads as absent.

import { ApiError, api } from '../../api/client';
import type { StudyDay } from '../../time/studyDay';
import { journalPayload } from '../../eventPayloads';
import { newUlid } from '../../ulid';
import { EXPLANATION_LANGUAGES } from './languages';
import { parseReview } from './review';
import type { JournalEntry, JournalSettings, Review, Suggestions } from './types';

const MAX_GUIDANCE = 2000;

const q = (workspaceId: number) => `?workspace=${workspaceId}`;
const entryPath = (workspaceId: number, id: string) => `/api/journal/entries/${encodeURIComponent(id)}${q(workspaceId)}`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

/** parseEntry decodes an entry of the server; null when it is not one. */
export function parseEntry(v: unknown): JournalEntry | null {
	if (!isRecord(v) || typeof v.id !== 'string' || v.id === '' || typeof v.text !== 'string') return null;
	return {
		id: v.id,
		date: str(v.date),
		title: str(v.title),
		text: v.text,
		source: v.source === 'photo' ? 'photo' : 'typed',
		createdAt: str(v.createdAt),
		updatedAt: str(v.updatedAt)
	};
}

/** listEntries: the workspace's entries, newest date first, then the most recently saved. */
export async function listEntries(workspaceId: number): Promise<JournalEntry[]> {
	const rows = await api<unknown>(`/api/journal/entries${q(workspaceId)}`);
	const entries: JournalEntry[] = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		const entry = parseEntry(row);
		if (entry) entries.push(entry);
	}
	return entries.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function getEntry(workspaceId: number, id: string): Promise<JournalEntry | null> {
	try {
		const entry = parseEntry(await api<unknown>(entryPath(workspaceId, id)));
		return entry !== null && entry.id === id ? entry : null;
	} catch (err) {
		if (err instanceof ApiError && err.status === 404 && err.code === 'not_found') return null;
		throw err;
	}
}

// A keepalive request body may not exceed 64 KiB; a bigger entry goes without.
const KEEPALIVE_MAX_BYTES = 60 * 1024;

/** saveEntry stores the entry and answers it as the server stored it (its updatedAt is the server's). */
export async function saveEntry(
	workspaceId: number,
	entry: JournalEntry,
	opts: { keepalive?: boolean } = {}
): Promise<JournalEntry> {
	const body = { date: entry.date, title: entry.title, text: entry.text, source: entry.source, createdAt: entry.createdAt };
	const keepalive = opts.keepalive === true && new Blob([JSON.stringify(body)]).size <= KEEPALIVE_MAX_BYTES;
	const answer = await api<unknown>(entryPath(workspaceId, entry.id), {
		method: 'PUT',
		body,
		...(keepalive ? { keepalive: true } : {})
	});
	return parseEntry(answer) ?? { ...entry, updatedAt: new Date().toISOString() };
}

/** newEntry starts an entry dated by the learner's day (the user's time zone). */
export function newEntry(
	source: 'typed' | 'photo',
	day: StudyDay,
	today: Date = new Date()
): JournalEntry {
	const now = new Date().toISOString();
	return {
		id: newUlid(),
		date: day.today(today.getTime()),
		title: '',
		text: '',
		source,
		createdAt: now,
		updatedAt: now
	};
}

/** Deletes the entry with its review; a missing entry is fine. */
export async function deleteEntry(workspaceId: number, id: string): Promise<void> {
	try {
		await api(entryPath(workspaceId, id), { method: 'DELETE' });
	} catch (err) {
		if (err instanceof ApiError && err.status === 404 && err.code === 'not_found') return;
		throw err;
	}
}

export async function getReview(workspaceId: number, entryId: string): Promise<Review | null> {
	const answer = await api<unknown>(`/api/journal/entries/${encodeURIComponent(entryId)}/review${q(workspaceId)}`);
	return parseReview(isRecord(answer) ? answer.review : null);
}

export async function getSuggestions(workspaceId: number): Promise<Suggestions | null> {
	const answer = await api<unknown>(`/api/journal/suggestions${q(workspaceId)}`);
	const v = isRecord(answer) ? answer.suggestions : null;
	return isRecord(v) && Array.isArray(v.items) ? (v as unknown as Suggestions) : null;
}

export const DEFAULT_SETTINGS: Readonly<JournalSettings> = { guidance: '', explanationLanguage: 'en' };

/** parseSettings reads settings leniently: anything else is the defaults, an unknown language "en". */
export function parseSettings(v: unknown): JournalSettings {
	if (!isRecord(v)) return { ...DEFAULT_SETTINGS };
	const language = str(v.explanationLanguage);
	return {
		guidance: [...str(v.guidance)].slice(0, MAX_GUIDANCE).join(''),
		explanationLanguage: EXPLANATION_LANGUAGES.some((l) => l.code === language) ? language : 'en'
	};
}

export async function getJournalSettings(workspaceId: number): Promise<JournalSettings> {
	return parseSettings(await api<unknown>(`/api/journal/settings${q(workspaceId)}`));
}

export async function saveJournalSettings(workspaceId: number, s: JournalSettings): Promise<void> {
	await api(`/api/journal/settings${q(workspaceId)}`, { method: 'PUT', body: s });
}

/** Records the once-per-day `journal` study event for an entry; rejects on failure. */
export function recordJournalEvent(events: Pick<EventLog, 'post'>, workspaceId: number, entryId: string, now: Date): Promise<void> {
	return events.post([{ id: newUlid(now.getTime()), workspaceId, device: 'web', ts: now.toISOString(), type: 'journal', payload: journalPayload(entryId) }]);
}
