import type { EventLog } from '$lib/events';
// Journal documents as workspace-scoped plugin data (qinqin-journal):
// entry:<id>, review:<id>, suggestions and settings. Reads of the list go
// through the prefix route, so the journal never pulls every plugin row.

import type { StudyDay } from '../../time/studyDay';
import { journalPayload } from '../../eventPayloads';
import { newUlid } from '../../ulid';
import { createPluginSdk, type DataScope } from '../sdk';
import { journalManifest } from './manifest';
import { EXPLANATION_LANGUAGES } from './languages';
import { parseReview } from './review';
import type { JournalEntry, JournalSettings, Review, Suggestions } from './types';

export const JOURNAL_PLUGIN_ID = journalManifest.id;

const sdk = createPluginSdk(journalManifest);

function docs(workspaceId: number): DataScope {
	return sdk.data.workspace(workspaceId);
}

const ENTRY_PREFIX = 'entry:';
const REVIEW_PREFIX = 'review:';
const SUGGESTIONS_KEY = 'suggestions';
const SETTINGS_KEY = 'settings';
const MAX_GUIDANCE = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function parseEntry(key: string, v: unknown): JournalEntry | null {
	if (!isRecord(v) || typeof v.id !== 'string' || v.id === '' || typeof v.text !== 'string') return null;
	if (key !== ENTRY_PREFIX + v.id) return null;
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

export async function listEntries(workspaceId: number): Promise<JournalEntry[]> {
	const rows = await docs(workspaceId).list(ENTRY_PREFIX);
	const entries: JournalEntry[] = [];
	for (const row of rows) {
		const entry = parseEntry(row.key, row.data);
		if (entry) entries.push(entry);
	}
	return entries.sort(
		(a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)
	);
}

export async function getEntry(workspaceId: number, id: string): Promise<JournalEntry | null> {
	const key = ENTRY_PREFIX + id;
	return parseEntry(key, await docs(workspaceId).get(key));
}

// A keepalive request body may not exceed 64 KiB; a bigger entry goes without.
const KEEPALIVE_MAX_BYTES = 60 * 1024;

export async function saveEntry(
	workspaceId: number,
	entry: JournalEntry,
	opts: { keepalive?: boolean } = {}
): Promise<JournalEntry> {
	const saved = { ...entry, updatedAt: new Date().toISOString() };
	const keepalive =
		opts.keepalive === true && new Blob([JSON.stringify(saved)]).size <= KEEPALIVE_MAX_BYTES;
	await docs(workspaceId).put(ENTRY_PREFIX + saved.id, saved, keepalive ? { keepalive: true } : {});
	return saved;
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

/** Deletes the entry, then its review; a missing document is fine. */
export async function deleteEntry(workspaceId: number, id: string): Promise<void> {
	await docs(workspaceId).delete(ENTRY_PREFIX + id);
	await docs(workspaceId).delete(REVIEW_PREFIX + id);
}

export async function getReview(workspaceId: number, entryId: string): Promise<Review | null> {
	return parseReview(await docs(workspaceId).find(REVIEW_PREFIX + entryId));
}

export async function getSuggestions(workspaceId: number): Promise<Suggestions | null> {
	const v = await docs(workspaceId).find(SUGGESTIONS_KEY);
	return isRecord(v) && Array.isArray(v.items) ? (v as unknown as Suggestions) : null;
}

const DEFAULT_SETTINGS: JournalSettings = { guidance: '', explanationLanguage: 'en' };

export async function getJournalSettings(workspaceId: number): Promise<JournalSettings> {
	const v = await docs(workspaceId).find(SETTINGS_KEY);
	if (!isRecord(v)) return { ...DEFAULT_SETTINGS };
	const language = str(v.explanationLanguage);
	return {
		guidance: [...str(v.guidance)].slice(0, MAX_GUIDANCE).join(''),
		explanationLanguage: EXPLANATION_LANGUAGES.some((l) => l.code === language) ? language : 'en'
	};
}

export async function saveJournalSettings(workspaceId: number, s: JournalSettings): Promise<void> {
	await docs(workspaceId).put(SETTINGS_KEY, s);
}

/** Records the once-per-day `journal` study event for an entry; rejects on failure. */
export function recordJournalEvent(events: Pick<EventLog, 'post'>, workspaceId: number, entryId: string, now: Date): Promise<void> {
	return sdk.events.record((batch) => events.post(batch), 'journal', workspaceId, journalPayload(entryId), now);
}
