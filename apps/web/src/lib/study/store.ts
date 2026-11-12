// Deck and card definitions as workspace-scoped plugin data. Reads come
// from one sync pull; writes are single-key PUTs and a delete is a
// tombstoning DELETE. A missing current workspace is an error: study
// data must never fall back to user-global or another workspace's rows.

import { get } from 'svelte/store';
import { api } from '../api/client';
import { newUlid } from '../ulid';
import { workspaces } from '../workspaces';
import type { Deck, StudyCard, StudyData } from './types';

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

function cardKey(id: string): string {
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
	if (typeof id !== 'string' || kind !== 'vocab' || typeof entryId !== 'number') return null;
	if (typeof createdAt !== 'string') return null;
	if (key !== cardKey(id)) return null;
	if (!Array.isArray(deckIds)) return null;
	const decks = [
		...new Set(deckIds.filter((deckId): deckId is string => typeof deckId === 'string'))
	];
	const card: StudyCard = { id, kind, entryId, deckIds: decks, createdAt };
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

async function putData(workspaceId: number, key: string, value: unknown): Promise<void> {
	await api(dataPath(key, workspaceId), { method: 'PUT', body: value });
}

async function deleteData(workspaceId: number, key: string): Promise<void> {
	await api(dataPath(key, workspaceId), { method: 'DELETE' });
}

/**
 * loadStudyData reads the flashcard rows of the current workspace. The
 * result always contains arrays, even when the pull has no plugin data.
 */
export async function loadStudyData(): Promise<StudyData> {
	return fetchStudyData(requireWorkspaceId());
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
		await putData(workspaceId, cardKey(card.id), { ...card, deckIds });
	}
	await deleteData(workspaceId, deckKey(id));
}

/**
 * addCard stores a new vocab card and returns it. `written` snapshots the
 * entry's written form, which per-character mastery reads without another
 * entry fetch; `sentenceId` keeps the example sentence shown on the review
 * front; `deckIds` names the decks the card belongs to (General by
 * default; unknown ids are the caller's choice — the setup page only
 * offers decks that exist). Adding an entry that already has a card is a
 * no-op: the entry page can race a slow pull, and a second card would
 * split its reviews and EXP permanently.
 */
export async function addCard(
	entryId: number,
	opts: { written?: string; sentenceId?: number; deckIds?: string[] } = {}
): Promise<StudyCard> {
	const workspaceId = requireWorkspaceId();
	const { cards } = await fetchStudyData(workspaceId);
	const existing = cards.find((card) => card.entryId === entryId);
	if (existing !== undefined) return existing;
	const deckIds = opts.deckIds ?? [GENERAL_DECK_ID];
	const chosen = [...new Set(deckIds.filter((id) => id !== ''))];
	const card: StudyCard = {
		id: newUlid(),
		kind: 'vocab',
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
	await putData(workspaceId, cardKey(card.id), card);
	return card;
}

/** cardsInDecks keeps the cards that belong to at least one of `deckIds`. */
export function cardsInDecks(cards: readonly StudyCard[], deckIds: readonly string[]): StudyCard[] {
	const wanted = new Set(deckIds);
	return cards.filter((card) => card.deckIds.some((id) => wanted.has(id)));
}
