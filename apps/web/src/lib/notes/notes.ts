// Personal notes on entries (issue #77): pure rules of the qinqin-core rows
// note:<entryId> = {version:1, entryId, text} and notecfg = {version:1,
// onAnswer}. The contract is docs/contracts/notes/README.md; the fixtures
// note-rows.json and note-text.json pin every rule here.

export const NOTE_PREFIX = 'note:';
export const NOTE_CFG_KEY = 'notecfg';
/** The editor's cap, in Unicode code points after normalising. */
export const NOTE_MAX_CHARS = 2000;

export interface Note {
	entryId: number;
	text: string;
	/** Every stored member other than version, entryId and text, kept verbatim on save. */
	extra: Record<string, unknown>;
}

export interface NoteCfg {
	onAnswer: boolean;
	extra: Record<string, unknown>;
}

export type NoteSave =
	| { kind: 'put'; text: string }
	| { kind: 'delete' }
	| { kind: 'tooLong'; chars: number };

const KEY_RE = /^note:([1-9][0-9]*)$/;
const OWN_NOTE = new Set(['version', 'entryId', 'text']);
const OWN_CFG = new Set(['version', 'onAnswer']);

function isPositiveId(n: unknown): n is number {
	return typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
}

/** noteKey is the row key of an entry's note; it throws on an id that is not a positive integer. */
export function noteKey(entryId: number): string {
	if (!isPositiveId(entryId)) throw new Error(`note: invalid entry id ${entryId}`);
	return `${NOTE_PREFIX}${entryId}`;
}

/** noteChars counts Unicode code points (an astral character counts 1). */
export function noteChars(text: string): number {
	return Array.from(text).length;
}

// A string holding JSON text is decoded, as the plugin SDK does for every row.
function asObject(data: unknown): Record<string, unknown> | null {
	let value = data;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value) as unknown;
		} catch {
			return null;
		}
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function extraOf(obj: Record<string, unknown>, own: Set<string>): Record<string, unknown> {
	const extra: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) if (!own.has(k)) extra[k] = v;
	return extra;
}

/**
 * parseNote reads a live row's data. Null (no note) unless data is a
 * version 1 object whose entryId equals the key's canonical positive id
 * and whose text is non-empty after trimming.
 */
export function parseNote(key: string, data: unknown): Note | null {
	const m = KEY_RE.exec(key);
	if (!m) return null;
	const id = Number(m[1]);
	if (!isPositiveId(id)) return null;
	const obj = asObject(data);
	if (!obj || obj.version !== 1 || obj.entryId !== id) return null;
	if (typeof obj.text !== 'string' || obj.text.trim() === '') return null;
	return { entryId: id, text: obj.text, extra: extraOf(obj, OWN_NOTE) };
}

/**
 * normalizeNoteText turns the editor's text into a save: CR LF and CR become
 * LF, trailing whitespace is trimmed; empty is a delete, more than
 * NOTE_MAX_CHARS code points is refused.
 */
export function normalizeNoteText(raw: string): NoteSave {
	const text = raw.replace(/\r\n?/g, '\n').trimEnd();
	if (text.trim() === '') return { kind: 'delete' };
	const chars = noteChars(text);
	if (chars > NOTE_MAX_CHARS) return { kind: 'tooLong', chars };
	return { kind: 'put', text };
}

/** serializeNote builds the stored object; the previous row's unknown members are kept. */
export function serializeNote(
	entryId: number,
	text: string,
	previous?: Note | null
): Record<string, unknown> {
	return { ...(previous?.extra ?? {}), version: 1, entryId, text };
}

/** parseNoteCfg: onAnswer is false only for a version 1 object holding onAnswer: false. */
export function parseNoteCfg(data: unknown): NoteCfg {
	const obj = asObject(data);
	if (!obj || obj.version !== 1) return { onAnswer: true, extra: {} };
	return { onAnswer: obj.onAnswer !== false, extra: extraOf(obj, OWN_CFG) };
}

export function serializeNoteCfg(
	onAnswer: boolean,
	previous?: { extra: Record<string, unknown> }
): Record<string, unknown> {
	return { ...(previous?.extra ?? {}), version: 1, onAnswer };
}

/** notesByEntry maps entry id to note text for the live rows of a list; other keys and invalid rows are skipped. */
export function notesByEntry(rows: { key: string; data: unknown }[]): Map<number, string> {
	const out = new Map<number, string>();
	for (const row of rows) {
		const note = parseNote(row.key, row.data);
		if (note) out.set(note.entryId, note.text);
	}
	return out;
}
