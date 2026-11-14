// Deck and card definitions as workspace-scoped plugin data. Reads come
// from one sync pull; writes are single-key PUTs and a delete is a
// tombstoning DELETE. A missing current workspace is an error: study
// data must never fall back to user-global or another workspace's rows.

import { get } from 'svelte/store';
import { api } from '../api/client';
import { newUlid } from '../ulid';
import { workspaces } from '../workspaces';
import type { StudyEvent } from '../events';
import { canonicalCards, compareCanonical, newCardId } from './canonical';
import { cardKey, parseReview } from './reviewParse';
import {
	CARD_KINDS,
	type Deck,
	type ReviewEvent,
	type StudyCard,
	type StudyCardKind,
	type StudyData,
	type StudyHistory
} from './types';

export const FLASHCARDS_PLUGIN_ID = 'qinqin-flashcards';

// The implicit deck always exists; it is never written to plugin data.
export const GENERAL_DECK_ID = 'general';

const DECK_PREFIX = 'deck:';
const CARD_PREFIX = 'card:';
const SYNC_PULL_PATH = '/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates';

// Only the fields the study layer reads; the server sends more.
interface PluginDataRow {
	pluginId: string;
	key: string;
	workspaceId: number | null;
	data: unknown;
	deletedAt: unknown;
}

interface SyncDelta {
	pluginData?: unknown;
}

/**
 * requireWorkspaceId returns the selected workspace id. Study data is
 * workspace-scoped, so there is nothing sensible to read or write
 * without one; callers get a plain Error instead of silently writing
 * user-global rows.
 */
function requireWorkspaceId(): number {
	const workspace = get(workspaces).current;
	if (workspace === null) {
		throw new Error('no workspace selected: study data is workspace-scoped');
	}
	return workspace.id;
}

function deckKey(id: string): string {
	return `${DECK_PREFIX}${id}`;
}

function cardRowKey(id: string): string {
	return `${CARD_PREFIX}${id}`;
}

function dataPath(key: string, workspaceId: number): string {
	return `/api/plugins/${FLASHCARDS_PLUGIN_ID}/data/${key}?workspace=${workspaceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * decodeData unwraps a plugin data payload. The API serves it as JSON,
 * but a row may still carry it as a string when a caller constructed
 * the fixture (or an older client wrote one); unparsable data is
 * treated as absent.
 */
function decodeData(data: unknown): unknown {
	if (typeof data !== 'string') return data;
	try {
		return JSON.parse(data) as unknown;
	} catch {
		return null;
	}
}

function asPluginDataRow(value: unknown): PluginDataRow | null {
	if (!isRecord(value)) return null;
	const { pluginId, key, workspaceId, data, deletedAt } = value;
	if (typeof pluginId !== 'string' || typeof key !== 'string') return null;
	const workspace = workspaceId === undefined ? null : workspaceId;
	if (workspace !== null && typeof workspace !== 'number') return null;
	return { pluginId, key, workspaceId: workspace, data, deletedAt };
}

function parseDeck(key: string, raw: unknown): Deck | null {
	if (!isRecord(raw)) return null;
	const { id, name, createdAt } = raw;
	if (typeof id !== 'string' || typeof name !== 'string' || typeof createdAt !== 'string') {
		return null;
	}
	// The key and the payload must agree: a write updates `deck:<id>`
	// and a mismatched row would make renames target the wrong key.
	if (key !== deckKey(id)) return null;
	return { id, name, createdAt };
}

function parseCard(key: string, raw: unknown): StudyCard | null {
	if (!isRecord(raw)) return null;
	const { id, kind, entryId, sentenceId, deckIds, createdAt, written } = raw;
	if (typeof id !== 'string' || typeof entryId !== 'number') return null;
	if (!CARD_KINDS.includes(kind as StudyCardKind)) return null;
	if (typeof createdAt !== 'string') return null;
	if (key !== cardRowKey(id)) return null;
	if (!Array.isArray(deckIds)) return null;
	const decks = [
		...new Set(deckIds.filter((deckId): deckId is string => typeof deckId === 'string'))
	];
	const card: StudyCard = {
		id,
		kind: kind as StudyCardKind,
		entryId,
		deckIds: decks,
		createdAt
	};
	if (typeof written === 'string') {
		card.written = written;
	}
	if (typeof sentenceId === 'number') {
		card.sentenceId = sentenceId;
	}
	return card;
}

/**
 * fetchStudyData pulls every synced row and keeps the live flashcard rows
 * of one workspace. Rows of other plugins, other (or no) workspaces,
 * tombstones, and keys outside `deck:`/`card:` are ignored; a malformed
 * payload is skipped rather than failing the whole page.
 */
async function fetchStudyData(workspaceId: number): Promise<StudyData> {
	const delta = await api<SyncDelta>(SYNC_PULL_PATH);
	const rows = Array.isArray(delta?.pluginData) ? delta.pluginData : [];
	const decks: Deck[] = [];
	const cards: StudyCard[] = [];

	for (const value of rows) {
		const row = asPluginDataRow(value);
		if (row === null) continue;
		if (row.pluginId !== FLASHCARDS_PLUGIN_ID) continue;
		if (row.workspaceId !== workspaceId) continue;
		if (row.deletedAt != null) continue;

		const data = decodeData(row.data);
		if (row.key.startsWith(DECK_PREFIX)) {
			const deck = parseDeck(row.key, data);
			if (deck !== null) decks.push(deck);
		} else if (row.key.startsWith(CARD_PREFIX)) {
			const card = parseCard(row.key, data);
			if (card !== null) cards.push(card);
		}
	}

	return { decks, cards };
}

// Called after every write with the workspace it touched, so caches of
// study data (studyData.ts) can drop what is now stale.
const writeListeners = new Set<(workspaceId: number) => void>();

/** onStudyWrite registers a listener for study-data writes; returns the unsubscribe. */
export function onStudyWrite(listener: (workspaceId: number) => void): () => void {
	writeListeners.add(listener);
	return () => writeListeners.delete(listener);
}

function notifyWrite(workspaceId: number): void {
	for (const listener of writeListeners) listener(workspaceId);
}

async function putData(workspaceId: number, key: string, value: unknown): Promise<void> {
	try {
		await api(dataPath(key, workspaceId), { method: 'PUT', body: value });
	} finally {
		// A failed write may still have landed: stale caches are dropped either way.
		notifyWrite(workspaceId);
	}
}

async function deleteData(workspaceId: number, key: string): Promise<void> {
	try {
		await api(dataPath(key, workspaceId), { method: 'DELETE' });
	} finally {
		notifyWrite(workspaceId);
	}
}

function eventsPath(workspaceId: number): string {
	return `/api/events?since=1970-01-01T00:00:00Z&workspace=${workspaceId}`;
}

/** fetchReviews reads the workspace's review history from the event log. */
async function fetchReviews(workspaceId: number): Promise<ReviewEvent[]> {
	const events = await api<StudyEvent[]>(eventsPath(workspaceId));
	if (!Array.isArray(events)) return [];
	return events
		.map((event) => (event.workspaceId === workspaceId ? parseReview(event) : null))
		.filter((event): event is ReviewEvent => event !== null);
}

/**
 * loadStudyData is THE read of a workspace's study state for anything
 * that shows, counts or schedules cards: decks, cards and the review
 * history, with duplicate cards (one word added on two devices before
 * card ids were deterministic) merged by `canonicalCards` and their
 * reviews re-pointed to the surviving card. Every page and widget goes
 * through it, so no call site can forget the merge. The selected
 * workspace is the default; pass the id the caller captured so cards and
 * reviews come from the same workspace. Writes (addCard, deleteDeck)
 * read the raw rows instead, so they see and rewrite every stored
 * duplicate.
 */
export async function loadStudyData(workspaceId?: number): Promise<StudyHistory> {
	const id = workspaceId ?? requireWorkspaceId();
	const [data, history] = await Promise.all([fetchStudyData(id), fetchReviews(id)]);
	const { cards, reviews, merged } = canonicalCards(data.cards, history);
	return { decks: data.decks, cards, reviews, merged };
}

/**
 * loadStudyDataFor reads the raw flashcard rows of one given workspace
 * (one sync pull, duplicates included). studyData.ts caches it for
 * "is this word studied" checks; anything that counts or schedules cards
 * uses loadStudyData.
 */
export function loadStudyDataFor(workspaceId: number): Promise<StudyData> {
	return fetchStudyData(workspaceId);
}

/** createDeck stores a new ULID-keyed deck and returns it. */
export async function createDeck(name: string): Promise<Deck> {
	const workspaceId = requireWorkspaceId();
	const deck: Deck = { id: newUlid(), name, createdAt: new Date().toISOString() };
	await putData(workspaceId, deckKey(deck.id), deck);
	return deck;
}

/**
 * renameDeck rewrites the deck under the same id and creation time.
 * Renaming a deck that is no longer stored is an error.
 */
export async function renameDeck(id: string, name: string): Promise<Deck> {
	const workspaceId = requireWorkspaceId();
	const { decks } = await fetchStudyData(workspaceId);
	const existing = decks.find((deck) => deck.id === id);
	if (existing === undefined) {
		throw new Error(`deck "${id}" not found`);
	}
	const renamed: Deck = { ...existing, name };
	await putData(workspaceId, deckKey(id), renamed);
	return renamed;
}

/**
 * deleteDeck tombstones the deck and strips it from every card that
 * references it, so a later delete cannot leave a card pointing only
 * at dead decks. A card left with no deck moves to `general`. Cards are
 * rewritten before the tombstone so a failed write cannot orphan them
 * behind a deleted deck.
 */
export async function deleteDeck(id: string): Promise<void> {
	const workspaceId = requireWorkspaceId();
	if (id === GENERAL_DECK_ID) {
		// The implicit deck has no stored row to tombstone and must survive.
		throw new Error('the general deck cannot be deleted');
	}
	const { cards } = await fetchStudyData(workspaceId);
	for (const card of cards) {
		if (!card.deckIds.includes(id)) continue;
		const remaining = card.deckIds.filter((deckId) => deckId !== id);
		const deckIds = remaining.length === 0 ? [GENERAL_DECK_ID] : remaining;
		await putData(workspaceId, cardRowKey(card.id), { ...card, deckIds });
	}
	await deleteData(workspaceId, deckKey(id));
}

/**
 * addCard stores a new card (vocab unless `kind` says otherwise) and
 * returns it. Cards dedupe by `cardKey`: kind, entry and, for sentence
 * cards, the sentence. `written` snapshots the
 * entry's written form, which per-character mastery reads without another
 * entry fetch; `sentenceId` keeps the example sentence shown on the review
 * front; `deckIds` names the decks the card belongs to (General by
 * default; unknown ids are the caller's choice — the setup page only
 * offers decks that exist). Adding an entry that already has a card is a
 * no-op: the entry page can race a slow pull, and a second card would
 * split its reviews and EXP. A new card's id is derived from its kind and
 * entry (`newCardId`), so two devices that both miss each other's card
 * write the same key and sync keeps one row (the later write's fields:
 * decks, snapshot, createdAt; reviews point at the shared id either way).
 * Older duplicates are merged at read time (loadStudyData). `workspaceId` names the
 * workspace explicitly (the reader adds to the book's workspace); the
 * selected one is the default.
 */
export async function addCard(
	entryId: number,
	opts: {
		kind?: StudyCardKind;
		written?: string;
		sentenceId?: number;
		deckIds?: string[];
		workspaceId?: number;
	} = {}
): Promise<StudyCard> {
	const workspaceId = opts.workspaceId ?? requireWorkspaceId();
	const kind = opts.kind ?? 'vocab';
	const { cards } = await fetchStudyData(workspaceId);
	const wanted = cardKey(kind, entryId, opts.sentenceId);
	// Several stored duplicates: answer with the one loadStudyData keeps.
	const existing = cards
		.filter((card) => cardKey(card.kind, card.entryId, card.sentenceId) === wanted)
		.sort(compareCanonical)[0];
	if (existing !== undefined) return existing;
	const deckIds = opts.deckIds ?? [GENERAL_DECK_ID];
	const chosen = [...new Set(deckIds.filter((id) => id !== ''))];
	const card: StudyCard = {
		id: freshCardId(cards, kind, entryId, opts.sentenceId),
		kind,
		entryId,
		deckIds: chosen.length === 0 ? [GENERAL_DECK_ID] : chosen,
		createdAt: new Date().toISOString()
	};
	if (typeof opts.written === 'string') {
		card.written = opts.written;
	}
	if (opts.sentenceId !== undefined) {
		card.sentenceId = opts.sentenceId;
	}
	await putData(workspaceId, cardRowKey(card.id), card);
	return card;
}

/**
 * freshCardId picks the id of a new card. The derived id (`newCardId`)
 * makes two devices adding the same card at once write one key. It can
 * only be taken by a card with another cardKey for sentence cards (one
 * per sentence once existed); then the sentence joins the id, and a ULID
 * is the last resort, so an existing card is never overwritten.
 */
function freshCardId(
	cards: readonly StudyCard[],
	kind: StudyCardKind,
	entryId: number,
	sentenceId?: number
): string {
	const taken = new Set(cards.map((card) => card.id));
	const base = newCardId(kind, entryId);
	if (!taken.has(base)) return base;
	if (kind === 'sentence' && sentenceId !== undefined) {
		const withSentence = `${base}-${sentenceId}`;
		if (!taken.has(withSentence)) return withSentence;
	}
	return newUlid();
}

/** cardsInDecks keeps the cards that belong to at least one of `deckIds`. */
export function cardsInDecks(cards: readonly StudyCard[], deckIds: readonly string[]): StudyCard[] {
	const wanted = new Set(deckIds);
	return cards.filter((card) => card.deckIds.some((id) => wanted.has(id)));
}
