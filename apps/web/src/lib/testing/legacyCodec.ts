// TEST-ONLY: the legacy row codec of server/internal/study/rows (FromLegacy,
// ToLegacy), mirrored so web tests can describe study state as the v0.3.0
// plugin rows it was and get the typed pull a migrated server serves for it
// (`typedPull`). Production code never imports this file: the web reads and
// writes typed rows only. Pinned by docs/contracts/backup/study-rows.json
// (legacyCodec.test.ts).

import {
	STUDY_COLLECTIONS,
	bodyOf,
	identityOf,
	parseRow,
	type StudyCollection,
	type StudyRow,
	type StudyRowBody
} from '../study/rows';

type Obj = Record<string, unknown>;

/**
 * legacyFamily: the typed collection of a legacy qinqin-flashcards key
 * (`card:`, `deck:`, `deckcfg:`, `limits:workspace`, `limits:deck:`,
 * `fsrs:set:`, `fsrs:active`); null for the keyed rows that stay plugin data.
 */
export function legacyFamily(key: string): StudyCollection | null {
	if (key.startsWith('card:')) return 'cards';
	if (key.startsWith('deck:')) return 'decks';
	if (key.startsWith('deckcfg:')) return 'deckSettings';
	if (key === 'limits:workspace' || key.startsWith('limits:deck:')) return 'limits';
	if (key.startsWith('fsrs:set:')) return 'fsrsSets';
	if (key === 'fsrs:active') return 'fsrsActive';
	return null;
}

const KINDS = ['vocab', 'sentence', 'writing', 'tone', 'reverse', 'cloze'];
const MAX_ID = 2 ** 53 - 1;

function isRecord(v: unknown): v is Obj {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function entryInt(v: unknown): number | null {
	return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_ID ? v : null;
}

function kindsOf(v: unknown, allowed: string[]): string[] | null {
	return Array.isArray(v) ? allowed.filter((k) => v.includes(k)) : null;
}

function take(o: Obj, name: string): { has: boolean; v: unknown } {
	if (!(name in o)) return { has: false, v: undefined };
	const v = o[name];
	delete o[name];
	return { has: true, v };
}

function source(raw: unknown): Obj | null {
	if (!isRecord(raw)) return null;
	const s = (k: string) => typeof raw[k] === 'string';
	if (raw.type === 'level' && s('packId') && s('level')) return { type: 'level', packId: raw.packId, level: raw.level };
	if (raw.type === 'plugin' && s('pluginId') && s('key')) return { type: 'plugin', pluginId: raw.pluginId, key: raw.key };
	if (raw.type === 'frequency' && s('packId') && entryInt(raw.size) !== null) {
		return { type: 'frequency', packId: raw.packId, size: raw.size };
	}
	return null;
}

function order(raw: unknown): Obj | null {
	if (!isRecord(raw)) return null;
	if (raw.by === 'added' || raw.by === 'frequency') return { by: raw.by };
	if (raw.by === 'level' && typeof raw.packId === 'string' && raw.packId !== '') return { by: 'level', packId: raw.packId };
	return null;
}

function limit(raw: unknown): Obj | null {
	if (raw === null) return { limit: null };
	return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 9999 ? { limit: raw } : null;
}

/** fromLegacy: the typed body of a legacy row, or null when the v0.3.0 parsers ignored it. */
export function fromLegacy(key: string, data: unknown): { collection: StudyCollection; body: Obj } | null {
	const c = legacyFamily(key);
	if (c === null || !isRecord(data)) return null;
	const o: Obj = structuredClone(data);
	const str = (n: string) => (typeof o[n] === 'string' ? (o[n] as string) : null);
	switch (c) {
		case 'cards': {
			const id = str('id');
			const kind = str('kind');
			const createdAt = str('createdAt');
			if (id === null || kind === null || createdAt === null || !KINDS.includes(kind)) return null;
			if (key !== `card:${id}`) return null;
			const entryId = entryInt(o.entryId);
			if (entryId === null || !Array.isArray(o.deckIds)) return null;
			const deckIds = [...new Set(o.deckIds.filter((d): d is string => typeof d === 'string'))];
			for (const n of ['id', 'kind', 'createdAt', 'entryId', 'deckIds']) delete o[n];
			const body: Obj = { id, kind, entryId, written: null, entryKind: null, sentenceId: null, skipKinds: [], deckIds, createdAt };
			const w = take(o, 'written');
			if (w.has) {
				if (typeof w.v === 'string') body.written = w.v;
				else o.written = w.v;
			}
			const ek = take(o, 'entryKind');
			if (ek.has) {
				if (ek.v === 'character') body.entryKind = 'character';
				else o.entryKind = ek.v;
			}
			const sid = take(o, 'sentenceId');
			if (sid.has) {
				if (entryInt(sid.v) !== null) body.sentenceId = sid.v;
				else o.sentenceId = sid.v;
			}
			const sk = take(o, 'skipKinds');
			if (sk.has) {
				const kinds = kindsOf(sk.v, KINDS.slice(1));
				if (kind === 'vocab' && kinds !== null) body.skipKinds = kinds;
				else o.skipKinds = sk.v;
			}
			return { collection: c, body: { ...body, extra: o } };
		}
		case 'decks': {
			const id = str('id');
			const name = str('name');
			const createdAt = str('createdAt');
			if (id === null || name === null || createdAt === null || key !== `deck:${id}`) return null;
			for (const n of ['id', 'name', 'createdAt']) delete o[n];
			const body: Obj = { id, name, createdAt, source: null };
			const s = take(o, 'source');
			if (s.has) {
				const parsed = source(s.v);
				if (parsed !== null) body.source = parsed;
				else o.source = s.v;
			}
			return { collection: c, body: { ...body, extra: o } };
		}
		case 'deckSettings': {
			const deckId = str('deckId');
			if (deckId === null || deckId === '' || key !== `deckcfg:${deckId}`) return null;
			const body: Obj = { deckId, cardTypes: kindsOf(o.cardTypes, ['reverse', 'cloze']) ?? [], newOrder: null };
			for (const n of ['deckId', 'cardTypes', 'updatedAt']) delete o[n];
			const no = take(o, 'newOrder');
			if (no.has) {
				const parsed = order(no.v);
				if (parsed !== null) body.newOrder = parsed;
				else o.newOrder = no.v;
			}
			return { collection: c, body: { ...body, extra: o } };
		}
		case 'limits': {
			let deckId: string | null = null;
			if (key !== 'limits:workspace') {
				deckId = key.slice('limits:deck:'.length);
				if (deckId === '') return null;
			}
			if (o.version !== 1) return null;
			delete o.version;
			const body: Obj = { deckId, new: null, reviews: null };
			for (const n of ['new', 'reviews']) {
				const f = take(o, n);
				if (!f.has) continue;
				const parsed = limit(f.v);
				if (parsed !== null) body[n] = parsed;
				else o[n] = f.v;
			}
			return { collection: c, body: { ...body, extra: o } };
		}
		case 'fsrsSets': {
			const id = str('id');
			const createdAt = str('createdAt');
			const src = str('source');
			if (id === null || createdAt === null || (src !== 'optimized' && src !== 'imported')) return null;
			if (key !== `fsrs:set:${id}`) return null;
			if (!Array.isArray(o.w) || o.w.length !== 21 || !o.w.every((x) => typeof x === 'number')) return null;
			const body: Obj = { id, w: o.w, createdAt, source: src, labelled: null, logLoss: null, baselineLogLoss: null };
			for (const n of ['id', 'createdAt', 'source', 'w']) delete o[n];
			for (const n of ['labelled', 'logLoss', 'baselineLogLoss']) {
				const f = take(o, n);
				if (!f.has) continue;
				if (typeof f.v !== 'number') return null;
				body[n] = f.v;
			}
			return { collection: c, body: { ...body, extra: o } };
		}
		case 'fsrsActive': {
			const body: Obj = { setId: null, changedAt: null };
			for (const n of ['setId', 'changedAt']) {
				const f = take(o, n);
				if (!f.has || f.v === null) continue;
				if (typeof f.v === 'string') body[n] = f.v;
				else o[n] = f.v;
			}
			return { collection: c, body: { ...body, extra: o } };
		}
	}
}

/** legacyKey: the qinqin-flashcards key of a typed row. */
export function legacyKey(c: StudyCollection, body: StudyRowBody): string {
	const id = identityOf(c, body);
	switch (c) {
		case 'cards':
			return `card:${id}`;
		case 'decks':
			return `deck:${id}`;
		case 'deckSettings':
			return `deckcfg:${id}`;
		case 'limits':
			return id === '' ? 'limits:workspace' : `limits:deck:${id}`;
		case 'fsrsSets':
			return `fsrs:set:${id}`;
		case 'fsrsActive':
			return 'fsrs:active';
	}
}

/** toLegacy: the legacy object of a typed body (extra first; a set typed member wins). */
export function toLegacy(c: StudyCollection, body: StudyRowBody, modifiedAt?: string): { key: string; data: Obj } {
	const b = bodyOf(body) as unknown as Obj;
	const o: Obj = { ...(b.extra as Obj) };
	const setIfNotNull = (names: string[]) => {
		for (const n of names) if (b[n] !== null) o[n] = b[n];
	};
	switch (c) {
		case 'cards':
			Object.assign(o, { id: b.id, kind: b.kind, entryId: b.entryId, deckIds: b.deckIds, createdAt: b.createdAt });
			setIfNotNull(['written', 'entryKind', 'sentenceId']);
			if ((b.skipKinds as unknown[]).length > 0) o.skipKinds = b.skipKinds;
			break;
		case 'decks':
			Object.assign(o, { id: b.id, name: b.name, createdAt: b.createdAt });
			setIfNotNull(['source']);
			break;
		case 'deckSettings':
			Object.assign(o, { deckId: b.deckId, cardTypes: b.cardTypes });
			setIfNotNull(['newOrder']);
			if (modifiedAt !== undefined) o.updatedAt = modifiedAt;
			break;
		case 'limits':
			o.version = 1;
			for (const n of ['new', 'reviews']) if (b[n] !== null) o[n] = (b[n] as { limit: number | null }).limit;
			break;
		case 'fsrsSets':
			Object.assign(o, { id: b.id, w: b.w, createdAt: b.createdAt, source: b.source });
			setIfNotNull(['labelled', 'logLoss', 'baselineLogLoss']);
			break;
		case 'fsrsActive':
			for (const n of ['setId', 'changedAt']) if (b[n] !== null || !(n in o)) o[n] = b[n];
			break;
	}
	return { key: legacyKey(c, body), data: o };
}

interface LegacyRow {
	key?: unknown;
	workspaceId?: unknown;
	data?: unknown;
	version?: unknown;
	updatedAt?: unknown;
	deletedAt?: unknown;
}

/**
 * typedPull: a pull body with keyed rows in the old shape (typed study rows
 * in their keyed form among the keyed rows), as the server answers it: every
 * readable typed-family row of a workspace moves into its typed collection
 * (meta kept); unreadable or user-global ones stay in `rows`; every typed
 * collection is present.
 */
export function typedPull(body: Obj): Obj {
	if (!Array.isArray(body.rows)) return body;
	const out: Obj = { ...body, rows: [] as unknown[] };
	for (const c of STUDY_COLLECTIONS) if (!Array.isArray(out[c])) out[c] = [];
	for (const raw of body.rows as LegacyRow[]) {
		const typed = typedOf(raw);
		if (typed === null) (out.rows as unknown[]).push(raw);
		else (out[typed.collection] as unknown[]).push(typed.row);
	}
	return out;
}

function typedOf(raw: LegacyRow): { collection: StudyCollection; row: StudyRow } | null {
	if (!isRecord(raw) || typeof raw.key !== 'string') return null;
	if (typeof raw.workspaceId !== 'number') return null;
	let data = raw.data;
	if (typeof data === 'string') {
		try {
			data = JSON.parse(data);
		} catch {
			return null;
		}
	}
	const typed = fromLegacy(raw.key, data);
	if (typed === null) return null;
	const row = parseRow(typed.collection, {
		...typed.body,
		workspaceId: raw.workspaceId,
		version: typeof raw.version === 'number' ? raw.version : 1,
		updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '2026-01-01T00:00:00Z',
		deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : null
	});
	return row === null ? null : { collection: typed.collection, row };
}

/**
 * pagedPull: the same body as the single page of a v2 round (docs/contracts/sync/):
 * typedPull's collections, plugin rows filled out to the contract shape, the
 * study collections the web asks for all present. Test-only.
 */
export function pagedPull(body: Obj): Obj {
	return pageOf(typedPull(body));
}

/** pageOf: a body already in the migrated shape (typed collections, keyed rows in rows) as one v2 page. */
export function pageOf(typed: Obj): Obj {
	const collections: Obj = {};
	for (const name of ['pluginStates', 'rows', ...STUDY_COLLECTIONS]) {
		const list = Array.isArray(typed[name]) ? (typed[name] as unknown[]) : [];
		collections[name] =
			name === 'rows'
				? list.map((r) => ({
						userId: 1,
						workspaceId: null,
						version: 1,
						updatedAt: '2026-01-01T00:00:00Z',
						deletedAt: null,
						...(r as Obj)
					}))
				: name === 'pluginStates'
					? list.map((r) => ({ userId: 1, enabled: true, order: 0, updatedAt: '2026-01-01T00:00:00Z', ...(r as Obj) }))
					: list;
	}
	return {
		format: 2,
		instanceId: '01JTEST0000000000000000000',
		until: '2026-11-17T00:00:00Z',
		scope: { workspaces: [], languages: [], catalogue: 'c' },
		restarted: [],
		collections,
		more: false,
		next: null,
		cursor: 'c2.test'
	};
}
