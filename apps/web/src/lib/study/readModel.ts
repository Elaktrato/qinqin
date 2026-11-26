// The read model of a workspace's study rows (#193). Pure: no network, no
// storage. `StudyRows` holds what the server sent for one workspace (the
// cache, cache.ts, keeps one per workspace): every readable typed row and
// keyed row of the study namespace with its stamps, tombstones included, and
// what this version could not read. `mergeRows` folds pull rows into it by key
// and stamp; `viewOf` derives what the pages read (StudyData), what a write
// plans against (StudySnapshot) and the unreadable report; `historyOf` adds the
// review log and merges duplicate cards.
//
// Reading rows follows docs/contracts/sync/ "Reading rows" (record 0002): a row
// that does not decode is skipped and counted, and the identity of an
// unreadable typed row (when readable) or keyed row is protected: no write
// replaces it. A row of another workspace is not this view's business.

import { canonicalCards } from './canonical';
import { DEFAULT_W, resolveState, type ParamSet } from './fsrs/params';
import type { DeckSettings } from './deckSettings';
import type { LimitPair } from './limits';
import { liveReviews } from './replaced';
import { parseReview } from './reviewParse';
import {
	STUDY_COLLECTIONS,
	activeOf,
	cardOf,
	deckOf,
	identityOf,
	limitsOf,
	parseRow,
	setOf,
	settingsOf,
	studyKey,
	type CardRow,
	type DeckRow,
	type DeckSettingsRow,
	type FsrsActiveRow,
	type FsrsSetRow,
	type LimitsRow,
	type StudyCollection,
	type StudyRow
} from './rows';
import { rawIdentity, type UnreadableCounts } from './unreadable';
import { VACATION_PREFIX, parseVacation, type VacationPeriod } from './vacation';
import { KNOWN_PREFIX, parseKnownBatch, parseKnownMark } from './knownMarks';
import type { StudySnapshot } from './plan';
import { GOALS_KEY, parseGoalsRow, type ParsedGoals } from '../goals/goals';
import { MILESTONE_KEY_PREFIX } from '../milestones/catalogue';
import { parseSeenRows, tombstoneStamps } from '../milestones/seen';
import { keyedRowOf, type KeyedRow } from '../sync/keyed';
import type { StudyEvent } from '$lib/events';
import type { ReviewEvent, StudyCard, StudyData, StudyHistory, Deck } from './types';

/** activeWeights is the workspace's FSRS weights; the defaults without a set. */
export function activeWeights(data: Pick<StudyData, 'fsrs'>): readonly number[] {
	return data.fsrs?.w ?? DEFAULT_W;
}

/** cardsInDecks keeps the cards that belong to at least one of `deckIds`. */
export function cardsInDecks(cards: readonly StudyCard[], deckIds: readonly string[]): StudyCard[] {
	const wanted = new Set(deckIds);
	return cards.filter((card) => card.deckIds.some((id) => wanted.has(id)));
}

type Counted = StudyCollection | 'rows';

/** What this version could not read of one row with a known identity. */
export interface UnreadableRow {
	collection: Counted;
	/** A tombstone that does not decode is protected but not counted: it shows nothing. */
	counted: boolean;
	/** The row's newest stamp, when it has a readable one (merging orders by it). */
	stamp?: string;
}

/**
 * StudyRows: the stored rows of one workspace as the server sent them.
 * Keys: typed rows `<collection>:<identity>` (studyKey); keyed rows
 * `ws:<key>` (this workspace) or `user:<key>` (user-global, e.g. vacations).
 */
export interface StudyRows {
	typed: Map<string, StudyRow>;
	keyed: Map<string, KeyedRow>;
	/** Rows that do not decode, by the key their readable identity gives. */
	unreadable: Map<string, UnreadableRow>;
	/** Rows that do not decode and have no readable identity, by their JSON text (counted only). */
	anonymous: Map<string, Counted>;
}

export function emptyRows(): StudyRows {
	return { typed: new Map(), keyed: new Map(), unreadable: new Map(), anonymous: new Map() };
}

/** copyRows: a copy whose maps can change without touching `rows`. */
export function copyRows(rows: StudyRows): StudyRows {
	return {
		typed: new Map(rows.typed),
		keyed: new Map(rows.keyed),
		unreadable: new Map(rows.unreadable),
		anonymous: new Map(rows.anonymous)
	};
}

/** keyedSlot: the StudyRows key of a keyed row. */
export function keyedSlot(key: string, global: boolean): string {
	return `${global ? 'user' : 'ws'}:${key}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The newest time the server holds for a row, live or tombstoned. */
export function newestOf(times: readonly unknown[]): string | undefined {
	return times
		.filter((t): t is string => typeof t === 'string' && !Number.isNaN(Date.parse(t)))
		.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function stampOfRaw(raw: unknown): string | undefined {
	return isRecord(raw) ? newestOf([raw.updatedAt, raw.deletedAt]) : undefined;
}

/** True when `incoming` may replace a row stamped `held`: no stamp, or not older. */
function newerOrSame(incoming: string | undefined, held: string | undefined): boolean {
	if (incoming === undefined || held === undefined) return true;
	return Date.parse(incoming) >= Date.parse(held);
}

/** The stamp the merge keeps for a key, readable or not. */
function heldStamp(rows: StudyRows, key: string, readable: { updatedAt: string; deletedAt: string | null } | undefined): string | undefined {
	if (readable !== undefined) return newestOf([readable.updatedAt, readable.deletedAt]);
	return rows.unreadable.get(key)?.stamp;
}

/** set: replaces a key and moves it to the end, as a fresh round orders a rewritten row. */
function setLast<V>(map: Map<string, V>, key: string, value: V): void {
	map.delete(key);
	map.set(key, value);
}

/** isStudyKey: a keyed row the study reads (goals, known marks, vacations, milestones). */
function isStudyKey(key: string): boolean {
	return key === GOALS_KEY || key.startsWith(KNOWN_PREFIX) || key.startsWith(VACATION_PREFIX) || key.startsWith(MILESTONE_KEY_PREFIX);
}

/**
 * mergeRows folds the rows of one pull round (`collections`, as the pager
 * merged them) into `rows`, by key: a row replaces what is held for its key
 * unless what is held is newer (a write of this tab the round started before).
 * Rows of other workspaces and keyed rows that are not the study's are left out. Answers
 * whether anything changed.
 */
export function mergeRows(rows: StudyRows, collections: Record<string, unknown[] | undefined>, workspaceId: number): boolean {
	let changed = false;
	const protect = (key: string, collection: Counted, raw: unknown): void => {
		const stamp = stampOfRaw(raw);
		const typedKey = collection === 'rows' ? undefined : key;
		const held = heldStamp(rows, key, typedKey === undefined ? rows.keyed.get(key) : rows.typed.get(key));
		if (!newerOrSame(stamp, held)) return;
		rows.typed.delete(key);
		rows.keyed.delete(key);
		const counted = !(isRecord(raw) && typeof raw.deletedAt === 'string');
		setLast(rows.unreadable, key, { collection, counted, ...(stamp === undefined ? {} : { stamp }) });
		changed = true;
	};
	const anonymous = (collection: Counted, raw: unknown): void => {
		if (isRecord(raw) && typeof raw.deletedAt === 'string') return;
		const text = JSON.stringify(raw) ?? String(raw);
		if (!rows.anonymous.has(text)) changed = true;
		rows.anonymous.set(text, collection);
	};

	for (const collection of STUDY_COLLECTIONS) {
		const list = collections[collection];
		for (const raw of Array.isArray(list) ? list : []) {
			const row = parseRow(collection, raw);
			if (row === null) {
				const where = isRecord(raw) ? raw.workspaceId : undefined;
				// Another workspace's row is not this load's business, readable or not.
				if (typeof where === 'number' && where !== workspaceId) continue;
				const identity = rawIdentity(collection, raw);
				if (identity === null) anonymous(collection, raw);
				else protect(studyKey(collection, identity), collection, raw);
				continue;
			}
			if (row.workspaceId !== workspaceId) continue;
			const key = studyKey(collection, identityOf(collection, row));
			if (!newerOrSame(newestOf([row.updatedAt, row.deletedAt]), heldStamp(rows, key, rows.typed.get(key)))) continue;
			rows.unreadable.delete(key);
			if (!sameRow(rows.typed.get(key), row)) changed = true;
			setLast(rows.typed, key, row);
		}
	}

	const keyedList = collections.rows;
	for (const value of Array.isArray(keyedList) ? keyedList : []) {
		// The core's other keyed rows (notes, lookups, layouts, ...) are not the study's.
		const foreign = isRecord(value) && typeof value.key === 'string' && !isStudyKey(value.key);
		if (foreign) continue;
		const row = keyedRowOf(value);
		if (row === null) {
			const where = isRecord(value) ? value.workspaceId : undefined;
			if (typeof where === 'number' && where !== workspaceId) continue;
			if (isRecord(value) && typeof value.key === 'string') protect(keyedSlot(value.key, where === null), 'rows', value);
			else anonymous('rows', value);
			continue;
		}
		if (row.workspaceId !== null && row.workspaceId !== workspaceId) continue;
		const key = keyedSlot(row.key, row.workspaceId === null);
		if (!newerOrSame(newestOf([row.updatedAt, row.deletedAt]), heldStamp(rows, key, rows.keyed.get(key)))) continue;
		rows.unreadable.delete(key);
		if (!sameContent(rows.keyed.get(key), row)) changed = true;
		setLast(rows.keyed, key, row);
	}
	return changed;
}

function sameRow(a: StudyRow | undefined, b: StudyRow): boolean {
	return a !== undefined && sameContent(a, b);
}

/**
 * sameContent: two held rows say the same, whatever their `version` (a row this
 * tab wrote is held with version 0; the server's copy of it carries its own).
 */
export function sameContent(a: unknown, b: unknown): boolean {
	const plain = (v: unknown): string => {
		if (typeof v !== 'object' || v === null || Array.isArray(v)) return JSON.stringify(v);
		const { version: _v, ...rest } = v as Record<string, unknown>;
		void _v;
		return JSON.stringify(rest);
	};
	return plain(a) === plain(b);
}

/** putTyped holds a row this tab wrote (in-place update after a push), as the server now holds it. */
export function putTyped(rows: StudyRows, collection: StudyCollection, row: StudyRow): void {
	const key = studyKey(collection, identityOf(collection, row));
	rows.unreadable.delete(key);
	setLast(rows.typed, key, row);
}

/** putKeyed holds a keyed row this tab wrote. */
export function putKeyed(rows: StudyRows, row: KeyedRow): void {
	const key = keyedSlot(row.key, row.workspaceId === null);
	rows.unreadable.delete(key);
	setLast(rows.keyed, key, row);
}

/** What one workspace's rows say: the pages' data, a write's snapshot, the unreadable report. */
export interface StudyView {
	data: StudyData;
	snapshot: StudySnapshot;
	counts: UnreadableCounts;
	/** The identities this version cannot read, in row order (the console warning names them). */
	unreadableKeys: string[];
	/** The keyed rows (keyedSlot keys) no write may replace. */
	keyedUnreadable: Set<string>;
}

/**
 * viewOf derives the view of one workspace's rows: live rows only for the data,
 * every stored typed row (tombstones too) and the newest stamps for the
 * snapshot. A keyed row whose family parser refuses it is unreadable too.
 */
export function viewOf(rows: StudyRows): StudyView {
	const decks: Deck[] = [];
	const cards: StudyCard[] = [];
	const sets: ParamSet[] = [];
	const deckSettings: Record<string, DeckSettings> = {};
	const vacations: VacationPeriod[] = [];
	let limitsWorkspace: Partial<LimitPair> | null = null;
	const limitsDecks: Record<string, Partial<LimitPair>> = {};
	let activeRaw: unknown = null;
	let goals: ParsedGoals = null;
	const known: number[] = [];
	const declared: NonNullable<StudyData['knownDeclared']> = [];
	const milestoneRows: { key: string; data: unknown; deletedAt: string | null; updatedAt?: string }[] = [];
	const counts: UnreadableCounts = {};
	const unreadableKeys: string[] = [];
	const keyedUnreadable = new Set<string>();
	const snapshot: StudySnapshot = { knownAt: new Map(), stored: new Map(), unreadable: new Set() };
	const count = (name: Counted): void => {
		counts[name] = (counts[name] ?? 0) + 1;
	};
	const unreadableKeyed = (slot: string): void => {
		count('rows');
		keyedUnreadable.add(slot);
		const key = slot.slice(slot.indexOf(':') + 1);
		unreadableKeys.push(`rows:${key}`);
		snapshot.unreadable.add(`rows:${key}`);
	};

	for (const [key, row] of rows.typed) {
		const newest = newestOf([row.updatedAt, row.deletedAt]);
		if (newest !== undefined) snapshot.knownAt.set(key, newest);
		snapshot.stored.set(key, row);
		if (row.deletedAt !== null) continue;
		const collection = key.slice(0, key.indexOf(':')) as StudyCollection;
		switch (collection) {
			case 'cards':
				cards.push(cardOf(row as CardRow));
				break;
			case 'decks':
				decks.push(deckOf(row as DeckRow));
				break;
			case 'deckSettings': {
				const settings = settingsOf(row as DeckSettingsRow);
				deckSettings[settings.deckId] = settings;
				break;
			}
			case 'limits': {
				const limits = row as LimitsRow;
				if (limits.deckId === null) limitsWorkspace = limitsOf(limits);
				else limitsDecks[limits.deckId] = limitsOf(limits);
				break;
			}
			case 'fsrsSets': {
				const set = setOf(row as FsrsSetRow);
				if (set !== null) sets.push(set);
				break;
			}
			case 'fsrsActive':
				activeRaw = activeOf(row as FsrsActiveRow);
				break;
		}
	}

	for (const [slot, row] of rows.keyed) {
		if (row.workspaceId === null) {
			if (!row.key.startsWith(VACATION_PREFIX) || row.deletedAt !== null) continue;
			const period = parseVacation(row.key, row.data);
			if (period !== null) vacations.push(period);
			else unreadableKeyed(slot);
			continue;
		}
		const newest = newestOf([row.updatedAt, row.deletedAt]);
		if (newest !== undefined) snapshot.knownAt.set(row.key, newest);
		if (row.key.startsWith(MILESTONE_KEY_PREFIX)) {
			// Seen milestones: tombstones too (a tombstone reads as not seen).
			milestoneRows.push({
				key: row.key,
				data: row.deletedAt !== null ? null : row.data,
				deletedAt: row.deletedAt,
				updatedAt: row.updatedAt
			});
			continue;
		}
		if (row.deletedAt !== null) continue;
		if (row.key === GOALS_KEY) {
			goals = parseGoalsRow(row.data);
			if (goals === null) unreadableKeyed(slot);
		} else if (row.key.startsWith(KNOWN_PREFIX)) {
			const entryId = parseKnownMark(row.key, row.data);
			if (entryId !== null) {
				known.push(entryId);
				const batch = parseKnownBatch(row.data);
				if (batch !== null) {
					const createdAt = (row.data as { createdAt?: unknown }).createdAt;
					declared.push({ entryId, createdAt: typeof createdAt === 'string' ? createdAt : '', batch });
				}
			} else unreadableKeyed(slot);
		}
	}

	for (const [key, row] of rows.unreadable) {
		if (row.counted) count(row.collection);
		if (row.collection === 'rows') {
			keyedUnreadable.add(key);
			const plain = key.slice(key.indexOf(':') + 1);
			unreadableKeys.push(`rows:${plain}`);
			snapshot.unreadable.add(`rows:${plain}`);
		} else {
			unreadableKeys.push(key);
			snapshot.unreadable.add(key);
		}
	}
	for (const collection of rows.anonymous.values()) count(collection);

	const seenMilestones = parseSeenRows(milestoneRows);
	const milestoneTombstones = tombstoneStamps(milestoneRows);
	// Absent (not empty) without any deckcfg row: workspaces that never
	// configured a deck read exactly as before.
	const data: StudyData = {
		decks,
		cards,
		fsrs: resolveState(sets, activeRaw),
		...(Object.keys(deckSettings).length > 0 ? { deckSettings } : {}),
		...(vacations.length > 0 ? { vacations } : {}),
		...(limitsWorkspace !== null || Object.keys(limitsDecks).length > 0
			? { limits: { workspace: limitsWorkspace, decks: limitsDecks } }
			: {}),
		...(goals === null ? {} : { goals }),
		...(known.length > 0 ? { known } : {}),
		...(declared.length > 0 ? { knownDeclared: declared } : {}),
		...(seenMilestones.size > 0 ? { seenMilestones } : {}),
		...(milestoneTombstones.size > 0 ? { milestoneTombstones } : {})
	};
	return { data, snapshot, counts, unreadableKeys, keyedUnreadable };
}

/**
 * reviewsOf keeps the workspace's review events of an event log, without
 * the replaced ones (a changed grade, #131: `liveReviews`), on the stored
 * card ids, before the duplicate-card merge.
 */
export function reviewsOf(workspaceId: number, events: readonly StudyEvent[]): ReviewEvent[] {
	return liveReviews(
		events
			.map((event) => (event.workspaceId === workspaceId ? parseReview(event) : null))
			.filter((event): event is ReviewEvent => event !== null)
	);
}

/** withQueued adds events not yet in the log (by id): reviews waiting in the outbox or sent since the log was read. */
export function withQueued(events: readonly StudyEvent[], queued: readonly StudyEvent[]): readonly StudyEvent[] {
	if (queued.length === 0) return events;
	const known = new Set(events.map((event) => event.id));
	const extra: StudyEvent[] = [];
	for (const event of queued) {
		if (known.has(event.id)) continue;
		known.add(event.id);
		extra.push(event);
	}
	return [...events, ...extra];
}

/**
 * historyOf is what every page that shows, counts or schedules cards reads:
 * the data with the review log, duplicate cards (one word added on two devices
 * before card ids were deterministic) merged by `canonicalCards` and their
 * reviews re-pointed to the surviving card.
 */
export function historyOf(workspaceId: number, data: StudyData, events: readonly StudyEvent[]): StudyHistory {
	const { cards, reviews, merged } = canonicalCards(data.cards, reviewsOf(workspaceId, events));
	return { ...data, cards, reviews, merged };
}
