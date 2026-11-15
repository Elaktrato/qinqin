// Journal documents as workspace-scoped plugin data (qinqin-journal):
// entry:<id>, review:<id>, suggestions and settings. Reads of the list go
// through the prefix route, so the journal never pulls every plugin row.

import { ApiError, api } from '../../api/client';
import { newUlid } from '../../ulid';
import { EXPLANATION_LANGUAGES } from './languages';
import type { JournalEntry, JournalSettings, Review, Suggestions } from './types';

export const JOURNAL_PLUGIN_ID = 'qinqin-journal';

const ENTRY_PREFIX = 'entry:';
const REVIEW_PREFIX = 'review:';
const SUGGESTIONS_KEY = 'suggestions';
const SETTINGS_KEY = 'settings';
const MAX_GUIDANCE = 2000;

interface Row {
	key?: unknown;
	data?: unknown;
}

function dataPath(key: string, workspaceId: number): string {
	return `/api/plugins/${JOURNAL_PLUGIN_ID}/data/${key}?workspace=${workspaceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The API serves data as JSON; a row may still carry a string. An
// unparsable string is treated as absent.
function decodeData(data: unknown): unknown {
	if (typeof data !== 'string') return data;
	try {
		return JSON.parse(data) as unknown;
	} catch {
		return null;
	}
}

function str(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function parseEntry(key: string, data: unknown): JournalEntry | null {
	const v = decodeData(data);
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

async function readRow(key: string, workspaceId: number): Promise<Row | null> {
	try {
		const row = await api<Row | undefined>(dataPath(key, workspaceId));
		return row ?? null;
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		throw err;
	}
}

export async function listEntries(workspaceId: number): Promise<JournalEntry[]> {
	const query = `workspace=${workspaceId}&prefix=${encodeURIComponent(ENTRY_PREFIX)}`;
	const rows = await api<Row[] | undefined>(`/api/plugins/${JOURNAL_PLUGIN_ID}/data?${query}`);
	const entries: JournalEntry[] = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		const entry = typeof row?.key === 'string' ? parseEntry(row.key, row.data) : null;
		if (entry) entries.push(entry);
	}
	return entries.sort(
		(a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)
	);
}

export async function getEntry(workspaceId: number, id: string): Promise<JournalEntry | null> {
	const key = ENTRY_PREFIX + id;
	const row = await readRow(key, workspaceId);
	return row ? parseEntry(key, row.data) : null;
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
	await api(dataPath(ENTRY_PREFIX + saved.id, workspaceId), {
		method: 'PUT',
		body: saved,
		...(keepalive ? { keepalive: true } : {})
	});
	return saved;
}

function localDate(d: Date): string {
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${month}-${day}`;
}

export function newEntry(source: 'typed' | 'photo', today: Date = new Date()): JournalEntry {
	const now = new Date().toISOString();
	return {
		id: newUlid(),
		date: localDate(today),
		title: '',
		text: '',
		source,
		createdAt: now,
		updatedAt: now
	};
}

async function deleteKey(key: string, workspaceId: number): Promise<void> {
	try {
		await api(dataPath(key, workspaceId), { method: 'DELETE' });
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return;
		throw err;
	}
}

/** Deletes the entry, then its review; a missing document is fine. */
export async function deleteEntry(workspaceId: number, id: string): Promise<void> {
	await deleteKey(ENTRY_PREFIX + id, workspaceId);
	await deleteKey(REVIEW_PREFIX + id, workspaceId);
}

export async function getReview(workspaceId: number, entryId: string): Promise<Review | null> {
	const row = await readRow(REVIEW_PREFIX + entryId, workspaceId);
	const v = row ? decodeData(row.data) : null;
	return isRecord(v) && typeof v.entryId === 'string' ? (v as unknown as Review) : null;
}

export async function getSuggestions(workspaceId: number): Promise<Suggestions | null> {
	const row = await readRow(SUGGESTIONS_KEY, workspaceId);
	const v = row ? decodeData(row.data) : null;
	return isRecord(v) && Array.isArray(v.items) ? (v as unknown as Suggestions) : null;
}

const DEFAULT_SETTINGS: JournalSettings = { guidance: '', explanationLanguage: 'en' };

export async function getJournalSettings(workspaceId: number): Promise<JournalSettings> {
	const row = await readRow(SETTINGS_KEY, workspaceId);
	const v = row ? decodeData(row.data) : null;
	if (!isRecord(v)) return { ...DEFAULT_SETTINGS };
	const language = str(v.explanationLanguage);
	return {
		guidance: [...str(v.guidance)].slice(0, MAX_GUIDANCE).join(''),
		explanationLanguage: EXPLANATION_LANGUAGES.some((l) => l.code === language) ? language : 'en'
	};
}

export async function saveJournalSettings(workspaceId: number, s: JournalSettings): Promise<void> {
	await api(dataPath(SETTINGS_KEY, workspaceId), { method: 'PUT', body: s });
}
