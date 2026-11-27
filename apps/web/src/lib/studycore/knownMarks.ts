// The learner's manual "I know this word" mark (#68): keyed row
// known:<entryId>, workspace-scoped, data
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

/**
 * KnownBatch names the declaration ("I already know this", #74) a mark was
 * written by: a ULID, how it was made and a label of its scope. Marks of one
 * batch are undone together.
 */
export interface KnownBatch {
	id: string;
	source: 'range' | 'placement';
	scope: string;
}

const SCOPE_MAX = 120;

/** parseKnownBatch reads the optional declaration fields of a mark's data; null for a mark made by hand. */
export function parseKnownBatch(raw: unknown): KnownBatch | null {
	if (!isRecord(raw)) return null;
	const { batch, source, scope } = raw;
	if (typeof batch !== 'string' || batch === '') return null;
	if (source !== 'range' && source !== 'placement') return null;
	return { id: batch, source, scope: typeof scope === 'string' ? scope.slice(0, SCOPE_MAX) : '' };
}

/** knownMarkRow is the row that marks `entryId` as known, optionally as part of a declaration. */
export function knownMarkRow(
	entryId: number,
	now: Date,
	batch?: KnownBatch
): { key: string; data: KnownMarkRow & Partial<Record<'batch' | 'source' | 'scope', string>> } {
	const data = { version: 1 as const, entryId, createdAt: now.toISOString() };
	return {
		key: knownMarkKey(entryId),
		data: batch === undefined ? data : { ...data, batch: batch.id, source: batch.source, scope: batch.scope.slice(0, SCOPE_MAX) }
	};
}
