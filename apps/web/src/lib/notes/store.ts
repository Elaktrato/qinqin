// Thin I/O for personal notes: qinqin-core plugin data of one workspace,
// through the plugin SDK (docs/contracts/notes/README.md). Rules live in
// notes.ts.

import { CORE_NAMESPACE, keyedData, type KeyedScope } from '../sync/keyed';
import {
	NOTE_CFG_KEY,
	NOTE_MAX_CHARS,
	NOTE_PREFIX,
	type Note,
	type NoteCfg,
	normalizeNoteText,
	noteKey,
	notesByEntry,
	parseNote,
	parseNoteCfg,
	serializeNote,
	serializeNoteCfg
} from './notes';

/** NoteTooLongError: the text has more than NOTE_MAX_CHARS code points; nothing was sent. */
export class NoteTooLongError extends Error {
	constructor(readonly chars: number) {
		super(`a note can have at most ${NOTE_MAX_CHARS} characters (this one has ${chars})`);
		this.name = 'NoteTooLongError';
	}
}

function data(ws: number): KeyedScope {
	return keyedData(CORE_NAMESPACE, ws);
}

/** loadNote reads an entry's note with the single-row route; 404 (none or deleted) is no note. */
export async function loadNote(ws: number, entryId: number): Promise<Note | null> {
	const key = noteKey(entryId);
	const value = await data(ws).get(key);
	return value === null ? null : parseNote(key, value);
}

/**
 * saveNote normalises and stores the text, keeping the previous row's
 * unknown members. Blank text deletes the note (null); too long throws
 * NoteTooLongError before any request.
 */
export async function saveNote(
	ws: number,
	entryId: number,
	text: string,
	previous: Note | null
): Promise<Note | null> {
	const save = normalizeNoteText(text);
	if (save.kind === 'tooLong') throw new NoteTooLongError(save.chars);
	if (save.kind === 'delete') {
		await deleteNote(ws, entryId);
		return null;
	}
	await data(ws).put(noteKey(entryId), serializeNote(entryId, save.text, previous));
	return { entryId, text: save.text, extra: { ...(previous?.extra ?? {}) } };
}

/** deleteNote tombstones the row; a missing note is fine. */
export async function deleteNote(ws: number, entryId: number): Promise<void> {
	await data(ws).delete(noteKey(entryId));
}

/** loadNotes maps every note of the workspace by entry id (one list request). */
export async function loadNotes(ws: number): Promise<Map<number, string>> {
	return notesByEntry(await data(ws).list(NOTE_PREFIX));
}

/** loadNoteCfg reads the workspace's answer-side switch; a missing row is ON. */
export async function loadNoteCfg(ws: number): Promise<NoteCfg> {
	const rows = await data(ws).list(NOTE_CFG_KEY);
	return parseNoteCfg(rows.find((r) => r.key === NOTE_CFG_KEY)?.data ?? null);
}

export async function saveNoteCfg(
	ws: number,
	onAnswer: boolean,
	previous?: { extra: Record<string, unknown> }
): Promise<void> {
	await data(ws).put(NOTE_CFG_KEY, serializeNoteCfg(onAnswer, previous));
}
