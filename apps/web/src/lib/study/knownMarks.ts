// The learner's manual "I know this word" mark (#68): plugin row
// known:<entryId> of qinqin-flashcards, workspace-scoped, data
// {version: 1, entryId, createdAt}. Valid only when the key is canonical
// (positive decimal, no sign, no leading zero) and equals data.entryId;
// anything else is ignored. Unmarking tombstones the row. Contract:
// docs/contracts/reader/word-states.json (rowCases).

export const KNOWN_PREFIX = 'known:';

export interface KnownMarkRow {
	version: 1;
	entryId: number;
	createdAt: string;
}

const CANONICAL = /^[1-9][0-9]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** parseKnownMark returns the entry id a row marks, or null for anything that is not a valid mark. */
export function parseKnownMark(key: string, raw: unknown): number | null {
	if (!key.startsWith(KNOWN_PREFIX)) return null;
	const digits = key.slice(KNOWN_PREFIX.length);
	if (!CANONICAL.test(digits)) return null;
	const id = Number(digits);
	if (!Number.isSafeInteger(id)) return null;
	if (!isRecord(raw) || raw.version !== 1 || raw.entryId !== id) return null;
	return id;
}

export function knownMarkKey(entryId: number): string {
	if (!Number.isSafeInteger(entryId) || entryId <= 0) throw new Error(`not an entry id: ${entryId}`);
	return `${KNOWN_PREFIX}${entryId}`;
}

/** knownMarkRow is the row that marks `entryId` as known. */
export function knownMarkRow(entryId: number, now: Date): { key: string; data: KnownMarkRow } {
	return { key: knownMarkKey(entryId), data: { version: 1, entryId, createdAt: now.toISOString() } };
}
