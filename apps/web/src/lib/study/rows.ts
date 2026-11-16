// Typed study rows on the wire (v0.4.0, #85): cards, decks, deck settings,
// limits, FSRS parameter sets and the active set, as `GET /api/sync/pull`
// serves them and `POST /api/sync/push` takes them. parseRow is the strict
// decode the server applies (server/internal/study/rows Decode + Validate);
// the *Of / *Row pairs convert between a typed row and the study layer's
// shapes. Contract: docs/contracts/study/ (rows.json, lww.json).

import { cleanSkipKinds } from './canonical';
import { cleanCardTypes, type DeckSettings } from './deckSettings';
import { validWeights, type ParamSet } from './fsrs/params';
import type { LimitPair } from './limits';
import { parseNewOrder, type NewOrder } from './newOrder';
import { CARD_KINDS, OPT_IN_KINDS, type Deck, type DeckSource, type OptInKind, type StudyCard, type StudyCardKind } from './types';

export type StudyCollection = 'cards' | 'decks' | 'deckSettings' | 'limits' | 'fsrsSets' | 'fsrsActive';

export const STUDY_COLLECTIONS: readonly StudyCollection[] = [
	'cards',
	'decks',
	'deckSettings',
	'limits',
	'fsrsSets',
	'fsrsActive'
];

type Extra = Record<string, unknown>;

export interface RowMeta {
	workspaceId: number;
	version: number;
	updatedAt: string;
	deletedAt: string | null;
}

export interface CardBody {
	id: string;
	kind: StudyCardKind;
	entryId: number;
	written: string | null;
	entryKind: 'character' | null;
	sentenceId: number | null;
	skipKinds: StudyCardKind[];
	deckIds: string[];
	createdAt: string;
	extra: Extra;
}

export interface DeckBody {
	id: string;
	name: string;
	createdAt: string;
	source: DeckSource | null;
	extra: Extra;
}

export interface DeckSettingsBody {
	deckId: string;
	cardTypes: OptInKind[];
	newOrder: NewOrder | null;
	extra: Extra;
}

/** One limit; `{limit: null}` is unlimited. */
export interface LimitField {
	limit: number | null;
}

export interface LimitsBody {
	/** null: the workspace row. */
	deckId: string | null;
	/** null: not set (inherits deck -> workspace -> default). */
	new: LimitField | null;
	reviews: LimitField | null;
	extra: Extra;
}

export interface FsrsSetBody {
	id: string;
	w: number[];
	createdAt: string;
	source: 'optimized' | 'imported';
	labelled: number | null;
	logLoss: number | null;
	baselineLogLoss: number | null;
	extra: Extra;
}

export interface FsrsActiveBody {
	setId: string | null;
	changedAt: string | null;
	extra: Extra;
}

export type CardRow = CardBody & RowMeta;
export type DeckRow = DeckBody & RowMeta;
export type DeckSettingsRow = DeckSettingsBody & RowMeta;
export type LimitsRow = LimitsBody & RowMeta;
export type FsrsSetRow = FsrsSetBody & RowMeta;
export type FsrsActiveRow = FsrsActiveBody & RowMeta;

export interface BodyOf {
	cards: CardBody;
	decks: DeckBody;
	deckSettings: DeckSettingsBody;
	limits: LimitsBody;
	fsrsSets: FsrsSetBody;
	fsrsActive: FsrsActiveBody;
}

export type StudyRowBody = BodyOf[StudyCollection];
export type StudyRow = StudyRowBody & RowMeta;

/** A parsed row remembers its collection (not a wire member). */
const COLLECTION = Symbol('collection');
type Tagged = { [COLLECTION]?: StudyCollection };

const MAX_ID = 2 ** 53 - 1;
const MAX_LIMIT = 9999;
const META_KEYS = ['workspaceId', 'version', 'updatedAt', 'deletedAt'] as const;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

const BODY_KEYS: Record<StudyCollection, { all: string[]; nullable: string[] }> = {
	cards: {
		all: ['id', 'kind', 'entryId', 'written', 'entryKind', 'sentenceId', 'skipKinds', 'deckIds', 'createdAt', 'extra'],
		nullable: ['written', 'entryKind', 'sentenceId']
	},
	decks: { all: ['id', 'name', 'createdAt', 'source', 'extra'], nullable: ['source'] },
	deckSettings: { all: ['deckId', 'cardTypes', 'newOrder', 'extra'], nullable: ['newOrder'] },
	limits: { all: ['deckId', 'new', 'reviews', 'extra'], nullable: ['deckId', 'new', 'reviews'] },
	fsrsSets: {
		all: ['id', 'w', 'createdAt', 'source', 'labelled', 'logLoss', 'baselineLogLoss', 'extra'],
		nullable: ['labelled', 'logLoss', 'baselineLogLoss']
	},
	fsrsActive: { all: ['setId', 'changedAt', 'extra'], nullable: ['setId', 'changedAt'] }
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ZERO_TIME = Date.parse('0001-01-01T00:00:00Z');

/** An RFC 3339 time that is not the zero time (the server refuses that as an edit time). */
function isTime(value: unknown): value is string {
	if (typeof value !== 'string' || !RFC3339.test(value)) return false;
	const ms = Date.parse(value);
	return !Number.isNaN(ms) && ms !== ZERO_TIME;
}

function isId(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ID;
}

function isStr(value: unknown): value is string {
	return typeof value === 'string';
}

function isNumOrNull(value: unknown): value is number | null {
	return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function sameKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
	const own = Object.keys(o);
	return own.length === keys.length && keys.every((k) => k in o);
}

/** The listed members of `list` in the order of `allowed`; null on a duplicate or a stranger. */
function inOrder<T extends string>(list: unknown, allowed: readonly T[]): T[] | null {
	if (!Array.isArray(list) || new Set(list).size !== list.length) return null;
	const out = allowed.filter((k) => list.includes(k));
	return out.length === list.length ? out : null;
}

function parseSource(raw: unknown): DeckSource | null | undefined {
	if (raw === null) return null;
	if (!isRecord(raw)) return undefined;
	if (raw.type === 'level' && sameKeys(raw, ['type', 'packId', 'level']) && isStr(raw.packId) && isStr(raw.level)) {
		return { type: 'level', packId: raw.packId, level: raw.level };
	}
	if (raw.type === 'plugin' && sameKeys(raw, ['type', 'pluginId', 'key']) && isStr(raw.pluginId) && isStr(raw.key)) {
		return { type: 'plugin', pluginId: raw.pluginId, key: raw.key };
	}
	if (raw.type === 'frequency' && sameKeys(raw, ['type', 'packId', 'size']) && isStr(raw.packId) && isId(raw.size)) {
		return { type: 'frequency', packId: raw.packId, size: raw.size };
	}
	return undefined;
}

function parseOrder(raw: unknown): NewOrder | null | undefined {
	if (raw === null) return null;
	if (!isRecord(raw)) return undefined;
	if ((raw.by === 'added' || raw.by === 'frequency') && sameKeys(raw, ['by'])) return { by: raw.by };
	if (raw.by === 'level' && sameKeys(raw, ['by', 'packId']) && isStr(raw.packId) && raw.packId !== '') {
		return { by: 'level', packId: raw.packId };
	}
	return undefined;
}

function parseLimit(raw: unknown): LimitField | null | undefined {
	if (raw === null) return null;
	if (!isRecord(raw) || !sameKeys(raw, ['limit'])) return undefined;
	const n = raw.limit;
	if (n === null) return { limit: null };
	if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_LIMIT) return { limit: n };
	return undefined;
}

/** The members of extra a set typed member shadows (the server drops them on write). */
function shadowed(c: StudyCollection, b: Record<string, unknown>): string[] {
	const set = (names: string[]) => names.filter((n) => b[n] !== null);
	switch (c) {
		case 'cards':
			return [
				'id',
				'kind',
				'entryId',
				'deckIds',
				'createdAt',
				...set(['written', 'entryKind', 'sentenceId']),
				...((b.skipKinds as unknown[]).length > 0 ? ['skipKinds'] : [])
			];
		case 'decks':
			return ['id', 'name', 'createdAt', ...set(['source'])];
		case 'deckSettings':
			return ['deckId', 'cardTypes', 'updatedAt', ...set(['newOrder'])];
		case 'limits':
			return ['version', ...set(['new', 'reviews'])];
		case 'fsrsSets':
			return ['id', 'w', 'createdAt', 'source', ...set(['labelled', 'logLoss', 'baselineLogLoss'])];
		case 'fsrsActive':
			return set(['setId', 'changedAt']);
	}
}

function withoutShadowed(c: StudyCollection, b: Record<string, unknown>): Extra {
	const extra = { ...(b.extra as Extra) };
	for (const name of shadowed(c, b)) delete extra[name];
	return extra;
}

/** parseBody checks the typed members of one collection; null when one is off. */
function parseBody(c: StudyCollection, raw: Record<string, unknown>): Record<string, unknown> | null {
	if (!isRecord(raw.extra)) return null;
	switch (c) {
		case 'cards': {
			const { id, kind, entryId, written, entryKind, sentenceId, skipKinds, deckIds, createdAt } = raw;
			if (!isStr(id) || !CARD_KINDS.includes(kind as StudyCardKind) || !isId(entryId) || !isStr(createdAt)) return null;
			if (written !== null && !isStr(written)) return null;
			if (entryKind !== null && entryKind !== 'character') return null;
			if (sentenceId !== null && !isId(sentenceId)) return null;
			const skips = inOrder(skipKinds, CARD_KINDS.slice(1));
			if (skips === null || (skips.length > 0 && kind !== 'vocab')) return null;
			if (!Array.isArray(deckIds) || !deckIds.every(isStr) || new Set(deckIds).size !== deckIds.length) return null;
			return { id, kind, entryId, written, entryKind, sentenceId, skipKinds: skips, deckIds: [...deckIds], createdAt };
		}
		case 'decks': {
			const { id, name, createdAt } = raw;
			const source = parseSource(raw.source);
			if (!isStr(id) || !isStr(name) || !isStr(createdAt) || source === undefined) return null;
			return { id, name, createdAt, source };
		}
		case 'deckSettings': {
			const { deckId } = raw;
			const cardTypes = inOrder(raw.cardTypes, OPT_IN_KINDS);
			const newOrder = parseOrder(raw.newOrder);
			if (!isStr(deckId) || deckId === '' || cardTypes === null || newOrder === undefined) return null;
			return { deckId, cardTypes, newOrder };
		}
		case 'limits': {
			const { deckId } = raw;
			const fresh = parseLimit(raw.new);
			const reviews = parseLimit(raw.reviews);
			if (deckId !== null && (!isStr(deckId) || deckId === '')) return null;
			if (fresh === undefined || reviews === undefined) return null;
			return { deckId, new: fresh, reviews };
		}
		case 'fsrsSets': {
			const { id, w, createdAt, source, labelled, logLoss, baselineLogLoss } = raw;
			if (!isStr(id) || !isStr(createdAt) || (source !== 'optimized' && source !== 'imported')) return null;
			if (!Array.isArray(w) || w.length !== 21 || !w.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
			if (!isNumOrNull(labelled) || !isNumOrNull(logLoss) || !isNumOrNull(baselineLogLoss)) return null;
			return { id, w: [...w], createdAt, source, labelled, logLoss, baselineLogLoss };
		}
		case 'fsrsActive': {
			const { setId, changedAt } = raw;
			if ((setId !== null && !isStr(setId)) || (changedAt !== null && !isStr(changedAt))) return null;
			return { setId, changedAt };
		}
	}
}

/**
 * parseRow reads one wire row of a collection strictly, as the server's
 * decode does: every typed key plus workspaceId and updatedAt present
 * (version and deletedAt may be left out), no unknown member, every value of
 * its type. null for anything else (a row is skipped, never guessed at).
 */
export function parseRow(c: StudyCollection, raw: unknown): StudyRow | null {
	const keys = BODY_KEYS[c];
	if (keys === undefined || !isRecord(raw)) return null;
	for (const k of [...keys.all, 'workspaceId', 'updatedAt']) {
		if (!(k in raw)) return null;
		if (raw[k] === null && !keys.nullable.includes(k)) return null;
	}
	for (const k of Object.keys(raw)) {
		if (!keys.all.includes(k) && !(META_KEYS as readonly string[]).includes(k)) return null;
	}
	const { workspaceId, version, updatedAt, deletedAt } = raw;
	if (!isId(workspaceId) || !isTime(updatedAt)) return null;
	if (version !== undefined && version !== null && !(typeof version === 'number' && Number.isInteger(version))) return null;
	if (deletedAt !== undefined && deletedAt !== null && !isTime(deletedAt)) return null;
	const body = parseBody(c, raw);
	if (body === null) return null;
	body.extra = raw.extra;
	body.extra = withoutShadowed(c, body);
	const row = {
		...body,
		workspaceId,
		version: typeof version === 'number' ? version : 0,
		updatedAt,
		deletedAt: typeof deletedAt === 'string' ? deletedAt : null
	} as StudyRow & Tagged;
	Object.defineProperty(row, COLLECTION, { value: c, enumerable: false });
	return row;
}

/** The collection a row was parsed from. */
export function collectionOf(row: StudyRow): StudyCollection | undefined {
	return (row as Tagged)[COLLECTION];
}

/** serializeRow: the row as the wire carries it (every key, meta included). */
export function serializeRow(row: StudyRow): Record<string, unknown> {
	return { ...row };
}

/** bodyOf: the row without its meta (what a push item's typed part holds). */
export function bodyOf<T extends StudyRowBody>(row: T & Partial<RowMeta>): T {
	const out: Record<string, unknown> = { ...row };
	for (const k of META_KEYS) delete out[k];
	return out as T;
}

/** identityOf: the row's key inside its workspace ('' for the workspace limits and the active set). */
export function identityOf(c: StudyCollection, row: StudyRowBody): string {
	switch (c) {
		case 'cards':
		case 'decks':
		case 'fsrsSets':
			return (row as CardBody | DeckBody | FsrsSetBody).id;
		case 'deckSettings':
			return (row as DeckSettingsBody).deckId;
		case 'limits':
			return (row as LimitsBody).deckId ?? '';
		case 'fsrsActive':
			return '';
	}
}

/** studyKey names a typed row in the store's maps: `<collection>:<identity>`. */
export function studyKey(c: StudyCollection, identity: string): string {
	return `${c}:${identity}`;
}

function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
	}
	if (isRecord(a) && isRecord(b)) {
		const ka = Object.keys(a).filter((k) => a[k] !== undefined);
		const kb = Object.keys(b).filter((k) => b[k] !== undefined);
		return ka.length === kb.length && ka.every((k) => k in b && jsonEqual(a[k], b[k]));
	}
	return false;
}

/**
 * sameBody: the typed members and extra are equal as JSON values (meta not
 * compared). The server skips such a write ("equal content"), so a writer
 * never sends one: a skipped item would read as "the server holds newer data".
 */
export function sameBody(a: StudyRowBody, b: StudyRowBody): boolean {
	return jsonEqual(bodyOf(a), bodyOf(b));
}

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

// ---- typed rows <-> the study layer's shapes

/** cardOf: the study card of a row (optional members only when set). */
export function cardOf(r: CardBody): StudyCard {
	const card: StudyCard = { id: r.id, kind: r.kind, entryId: r.entryId, deckIds: [...r.deckIds], createdAt: r.createdAt };
	if (r.written !== null) card.written = r.written;
	if (r.entryKind === 'character') card.entryKind = 'character';
	if (r.sentenceId !== null) card.sentenceId = r.sentenceId;
	if (r.kind === 'vocab' && r.skipKinds.length > 0) card.skipKinds = [...r.skipKinds];
	// Key order as the legacy rows had it (tests compare objects).
	return orderCard(card);
}

function orderCard(card: StudyCard): StudyCard {
	const { id, kind, entryId, written, entryKind, sentenceId, skipKinds, deckIds, createdAt } = card;
	return {
		id,
		kind,
		entryId,
		...(written === undefined ? {} : { written }),
		...(entryKind === undefined ? {} : { entryKind }),
		...(sentenceId === undefined ? {} : { sentenceId }),
		...(skipKinds === undefined ? {} : { skipKinds }),
		deckIds,
		createdAt
	};
}

/** cardRow: the typed body of a study card; `extra` is the stored row's, echoed back. */
export function cardRow(c: StudyCard, extra: Extra = {}): CardBody {
	const skipKinds = c.kind === 'vocab' ? cleanSkipKinds(c.skipKinds ?? []) : [];
	const body: CardBody = {
		id: c.id,
		kind: c.kind,
		entryId: c.entryId,
		written: c.written ?? null,
		entryKind: c.entryKind === 'character' ? 'character' : null,
		sentenceId: c.sentenceId ?? null,
		skipKinds,
		deckIds: [...new Set(c.deckIds)],
		createdAt: c.createdAt,
		extra: {}
	};
	body.extra = withoutShadowed('cards', { ...body, extra });
	return body;
}

export function deckOf(r: DeckBody): Deck {
	return { id: r.id, name: r.name, createdAt: r.createdAt, ...(r.source === null ? {} : { source: { ...r.source } }) };
}

export function deckRow(d: Deck, extra: Extra = {}): DeckBody {
	const body: DeckBody = { id: d.id, name: d.name, createdAt: d.createdAt, source: d.source ?? null, extra: {} };
	body.extra = withoutShadowed('decks', { ...body, extra });
	return body;
}

/** settingsOf: deck settings with `extra` as stored (an unreadable order stays there). */
export function settingsOf(r: DeckSettingsBody): DeckSettings {
	return {
		deckId: r.deckId,
		cardTypes: [...r.cardTypes],
		...(r.newOrder === null ? {} : { newOrder: r.newOrder }),
		extra: { ...r.extra }
	};
}

export function settingsRow(s: DeckSettings): DeckSettingsBody {
	const body: DeckSettingsBody = {
		deckId: s.deckId,
		cardTypes: cleanCardTypes(s.cardTypes),
		newOrder: parseNewOrder(s.newOrder),
		extra: {}
	};
	body.extra = withoutShadowed('deckSettings', { ...body, extra: s.extra });
	return body;
}

/** limitsOf: the fields a row sets (`{limit: null}` = unlimited); an unset field is absent. */
export function limitsOf(r: LimitsBody): Partial<LimitPair> {
	const out: Partial<LimitPair> = {};
	if (r.new !== null) out.new = r.new.limit;
	if (r.reviews !== null) out.reviews = r.reviews.limit;
	return out;
}

export function limitsRow(deckId: string | null, pair: Partial<LimitPair>, extra: Extra = {}): LimitsBody {
	const body: LimitsBody = {
		deckId,
		new: 'new' in pair && pair.new !== undefined ? { limit: pair.new } : null,
		reviews: 'reviews' in pair && pair.reviews !== undefined ? { limit: pair.reviews } : null,
		extra: {}
	};
	body.extra = withoutShadowed('limits', { ...body, extra });
	return body;
}

/** setOf: the parameter set, or null when its weights are unusable (the defaults apply). */
export function setOf(r: FsrsSetBody): ParamSet | null {
	const w = validWeights(r.w);
	if (w === null) return null;
	const set: ParamSet = { id: r.id, w, createdAt: r.createdAt, source: r.source };
	if (r.labelled !== null) set.labelled = r.labelled;
	if (r.logLoss !== null) set.logLoss = r.logLoss;
	if (r.baselineLogLoss !== null) set.baselineLogLoss = r.baselineLogLoss;
	return set;
}

export function setRow(s: ParamSet, extra: Extra = {}): FsrsSetBody {
	const body: FsrsSetBody = {
		id: s.id,
		w: [...s.w],
		createdAt: s.createdAt,
		source: s.source,
		labelled: s.labelled ?? null,
		logLoss: s.logLoss ?? null,
		baselineLogLoss: s.baselineLogLoss ?? null,
		extra: {}
	};
	body.extra = withoutShadowed('fsrsSets', { ...body, extra });
	return body;
}

export function activeOf(r: FsrsActiveBody): { setId: string | null; changedAt: string | null } {
	return { setId: r.setId, changedAt: r.changedAt };
}

export function activeRow(setId: string | null, changedAt: string | null, extra: Extra = {}): FsrsActiveBody {
	const body: FsrsActiveBody = { setId, changedAt, extra: {} };
	body.extra = withoutShadowed('fsrsActive', { ...body, extra });
	return body;
}
