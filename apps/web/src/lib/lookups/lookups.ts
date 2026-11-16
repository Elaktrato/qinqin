// Lookup history (#72): the pure rules of the qinqin-core `lookups` row (one
// per workspace) and the user-global `lookupcfg` switch. Contract:
// docs/contracts/lookups/README.md; fixtures lookup-rows.json,
// lookup-merge.json, lookup-prompt.json. I/O lives in store.ts, buffering in
// recorder.ts.

export const LOOKUPS_KEY = 'lookups';
export const LOOKUP_CFG_KEY = 'lookupcfg';
export const LOOKUP_CAP = 500;
export const LOOKUP_DEDUPE_MS = 600_000;
export const LOOKUP_MAX_COUNT = 1_000_000;
export const LOOKUP_MAX_BOOKS = 3;
export const PROMPT_MIN_COUNT = 3;
export const PROMPT_MAX = 10;

export type LookupSource = 'reader' | 'lesson' | 'search';

export interface LookupItem {
	entryId: number;
	count: number;
	firstAt: string;
	lastAt: string;
	sources: Record<string, number>;
	books: number[];
}

export interface LookupHistory {
	clearedAt: string | null;
	items: LookupItem[];
	/** Unknown top-level members, kept verbatim by every write. */
	extra: Record<string, unknown>;
}

export interface LookupHit {
	entryId: number;
	at: string;
	source: LookupSource;
	bookId?: number;
}

export type LookupState = 'new' | 'learning' | 'known';

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** instant of an RFC 3339 timestamp in ms, or null. */
export function instant(v: unknown): number | null {
	if (typeof v !== 'string' || !RFC3339.test(v)) return null;
	const t = Date.parse(v);
	if (!Number.isFinite(t)) return null;
	// Date.parse rolls invalid days over (2026-02-30 -> March 2); reject those.
	const [y, mo, d] = v.slice(0, 10).split('-').map(Number);
	const hh = Number(v.slice(11, 13));
	const mm = Number(v.slice(14, 16));
	const ss = Number(v.slice(17, 19));
	if (mo < 1 || mo > 12 || d < 1 || hh > 23 || mm > 59 || ss > 59) return null;
	if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
	return t;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function decode(data: unknown): unknown {
	if (typeof data !== 'string') return data;
	try {
		return JSON.parse(data) as unknown;
	} catch {
		return data;
	}
}

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const clamp = (n: number) => Math.min(n, LOOKUP_MAX_COUNT);

export const emptyHistory = (): LookupHistory => ({ clearedAt: null, items: [], extra: {} });

function parseItem(raw: unknown): LookupItem | null {
	if (!isObject(raw)) return null;
	const { entryId, count, firstAt, lastAt } = raw;
	if (!isPositiveInt(entryId) || !isPositiveInt(count)) return null;
	const first = instant(firstAt);
	const last = instant(lastAt);
	if (first === null || last === null) return null;
	const sources: Record<string, number> = {};
	if (isObject(raw.sources)) {
		for (const [k, v] of Object.entries(raw.sources)) {
			if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) sources[k] = clamp(v);
		}
	}
	const books: number[] = [];
	if (Array.isArray(raw.books)) {
		for (const b of raw.books) {
			if (isPositiveInt(b) && !books.includes(b)) books.push(b);
			if (books.length === LOOKUP_MAX_BOOKS) break;
		}
	}
	return {
		entryId,
		count: clamp(count),
		firstAt: first > last ? (lastAt as string) : (firstAt as string),
		lastAt: lastAt as string,
		sources,
		books
	};
}

/** Newest first: lastAt desc, count desc, entryId asc. */
function compareItems(a: LookupItem, b: LookupItem): number {
	return (
		(instant(b.lastAt) ?? 0) - (instant(a.lastAt) ?? 0) || b.count - a.count || a.entryId - b.entryId
	);
}

function sortAndCap(items: LookupItem[]): LookupItem[] {
	return [...items].sort(compareItems).slice(0, LOOKUP_CAP);
}

/** parseLookups reads a stored row; anything unreadable is an empty history. */
export function parseLookups(data: unknown, deletedAt: string | null = null): LookupHistory {
	if (deletedAt !== null && deletedAt !== undefined) return emptyHistory();
	const row = decode(data);
	if (!isObject(row) || row.version !== 1) return emptyHistory();
	const extra: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (k !== 'version' && k !== 'clearedAt' && k !== 'items') extra[k] = v;
	}
	const clearedAt = instant(row.clearedAt) === null ? null : (row.clearedAt as string);
	const seen = new Set<number>();
	const items: LookupItem[] = [];
	for (const raw of Array.isArray(row.items) ? row.items : []) {
		const item = parseItem(raw);
		if (!item || seen.has(item.entryId)) continue;
		seen.add(item.entryId);
		items.push(item);
	}
	return { clearedAt, items: sortAndCap(items), extra };
}

/** serializeLookups is the stored form: {...extra, version: 1, clearedAt, items}. */
export function serializeLookups(h: LookupHistory): Record<string, unknown> {
	return {
		...h.extra,
		version: 1,
		clearedAt: h.clearedAt,
		items: h.items.map((i) => ({
			entryId: i.entryId,
			count: i.count,
			firstAt: i.firstAt,
			lastAt: i.lastAt,
			sources: { ...i.sources },
			books: [...i.books]
		}))
	};
}

function copyItem(i: LookupItem): LookupItem {
	return { ...i, sources: { ...i.sources }, books: [...i.books] };
}

/**
 * mergeLookups applies buffered hits in time order: a lookup within
 * LOOKUP_DEDUPE_MS of the stored lastAt is a repeat (lastAt and books move,
 * count and sources stay); a hit at or before clearedAt is dropped.
 */
export function mergeLookups(h: LookupHistory, hits: readonly LookupHit[]): LookupHistory {
	const cleared = instant(h.clearedAt);
	const byId = new Map<number, LookupItem>(h.items.map((i) => [i.entryId, copyItem(i)]));
	const ordered = hits
		.map((hit, idx) => ({ hit, idx, t: instant(hit.at) }))
		.filter((x): x is { hit: LookupHit; idx: number; t: number } => x.t !== null && isPositiveInt(x.hit.entryId))
		.sort((a, b) => a.t - b.t || a.idx - b.idx);
	for (const { hit, t } of ordered) {
		if (cleared !== null && t <= cleared) continue;
		const book = isPositiveInt(hit.bookId) ? hit.bookId : null;
		const item = byId.get(hit.entryId);
		if (!item) {
			byId.set(hit.entryId, {
				entryId: hit.entryId,
				count: 1,
				firstAt: hit.at,
				lastAt: hit.at,
				sources: { [hit.source]: 1 },
				books: book === null ? [] : [book]
			});
			continue;
		}
		const last = instant(item.lastAt) ?? t;
		const first = instant(item.firstAt) ?? last;
		if (Math.abs(t - last) >= LOOKUP_DEDUPE_MS) {
			item.count = clamp(item.count + 1);
			item.sources[hit.source] = clamp((item.sources[hit.source] ?? 0) + 1);
		}
		if (book !== null) {
			if (t >= last) item.books = [book, ...item.books.filter((b) => b !== book)];
			else if (!item.books.includes(book)) item.books.push(book);
			item.books = item.books.slice(0, LOOKUP_MAX_BOOKS);
		}
		if (t > last) item.lastAt = hit.at;
		if (t < first) item.firstAt = hit.at;
	}
	return { clearedAt: h.clearedAt, items: sortAndCap([...byId.values()]), extra: { ...h.extra } };
}

export function removeLookups(h: LookupHistory, entryIds: readonly number[]): LookupHistory {
	const drop = new Set(entryIds);
	return { clearedAt: h.clearedAt, items: h.items.filter((i) => !drop.has(i.entryId)).map(copyItem), extra: { ...h.extra } };
}

export function clearedLookups(h: LookupHistory, now: Date): LookupHistory {
	return { clearedAt: now.toISOString(), items: [], extra: { ...h.extra } };
}

/** staleAfterClear: an item at or before clearedAt came back (a racing flush). */
export function staleAfterClear(h: LookupHistory): boolean {
	const cleared = instant(h.clearedAt);
	if (cleared === null) return false;
	return h.items.some((i) => (instant(i.lastAt) ?? Infinity) <= cleared);
}

/** promptItems: often looked-up words that are still new, at most PROMPT_MAX. */
export function promptItems(h: LookupHistory, stateOf: (entryId: number) => LookupState): LookupItem[] {
	return h.items
		.filter((i) => i.count >= PROMPT_MIN_COUNT && stateOf(i.entryId) === 'new')
		.sort((a, b) => b.count - a.count || (instant(b.lastAt) ?? 0) - (instant(a.lastAt) ?? 0) || a.entryId - b.entryId)
		.slice(0, PROMPT_MAX);
}

export interface LookupCfg {
	record: boolean;
	extra: Record<string, unknown>;
}

/** parseLookupCfg: recording is off only for a version 1 row with record === false. */
export function parseLookupCfg(data: unknown): LookupCfg {
	const row = decode(data);
	if (!isObject(row) || row.version !== 1) return { record: true, extra: {} };
	const extra: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (k !== 'version' && k !== 'record') extra[k] = v;
	}
	return { record: row.record !== false, extra };
}

export function serializeLookupCfg(record: boolean, previous?: { extra: Record<string, unknown> }): Record<string, unknown> {
	return { ...(previous?.extra ?? {}), version: 1, record };
}
