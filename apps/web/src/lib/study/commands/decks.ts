// Deck commands (#193): create, rename, delete, and the deck settings rows
// (opt-in card kinds, new-card order). Each plans against the workspace's
// view (data.ts) and writes through commands/write.ts.

import { GENERAL_DECK_ID, type Deck, type OptInKind } from '../types';
import { cleanCardTypes, type DeckSettings } from '../deckSettings';
import type { NewOrder } from '../newOrder';
import { cardRow, deckRow, settingsRow, studyKey } from '../rows';
import { newUlid } from '../../ulid';
import { extraOf, studyDelete, studyWrite, type StudyWrite } from '../plan';
import { planningView } from '../data';
import { pushOptional, pushStudy, requireWorkspaceArg } from './write';

/** createDeck stores a new ULID-keyed deck and returns it. */
export async function createDeck(workspaceId: number, name: string): Promise<Deck> {
	requireWorkspaceArg(workspaceId, 'createDeck');
	const deck: Deck = {
		id: newUlid(),
		name,
		createdAt: new Date().toISOString(),
	};
	await pushStudy(workspaceId, [{ collection: 'decks', row: deckRow(deck) }]);
	return deck;
}

/**
 * renameDeck rewrites the deck under the same id and creation time.
 * Renaming a deck that is no longer stored is an error.
 */
export async function renameDeck(workspaceId: number, id: string, name: string): Promise<Deck> {
	requireWorkspaceArg(workspaceId, 'renameDeck');
	const { data: { decks }, snapshot: snap } = await planningView(workspaceId);
	const existing = decks.find((deck) => deck.id === id);
	if (existing === undefined) {
		throw new Error(`deck "${id}" not found`);
	}
	const renamed: Deck = { ...existing, name };
	const write = studyWrite(snap, 'decks', deckRow(renamed, extraOf(snap, 'decks', id)));
	if (write !== null) await pushStudy(workspaceId, [write]);
	return renamed;
}

/**
 * deleteDeck tombstones the deck and strips it from every card that
 * references it, so a later delete cannot leave a card pointing only
 * at dead decks. A card left with no deck moves to `general`. Cards are
 * rewritten before the tombstone so a failed write cannot orphan them
 * behind a deleted deck.
 */
export async function deleteDeck(workspaceId: number, id: string): Promise<void> {
	requireWorkspaceArg(workspaceId, 'deleteDeck');
	if (id === GENERAL_DECK_ID) {
		// The implicit deck has no stored row to tombstone and must survive.
		throw new Error('the general deck cannot be deleted');
	}
	const { data: { cards }, snapshot: snap } = await planningView(workspaceId);
	// One batch (chunks of 200) instead of a request per card: a big copied
	// deck is a handful of requests. A failure throws before the tombstone.
	const rows = cards
		.filter((card) => card.deckIds.includes(id))
		.map((card) => {
			const remaining = card.deckIds.filter((deckId) => deckId !== id);
			const deckIds = remaining.length === 0 ? [GENERAL_DECK_ID] : remaining;
			return studyWrite(snap, 'cards', cardRow({ ...card, deckIds }, extraOf(snap, 'cards', card.id)));
		})
		.filter((write): write is StudyWrite => write !== null);
	await pushStudy(workspaceId, rows);
	const tombstone = studyDelete(snap, 'decks', id);
	if (tombstone !== null) await pushStudy(workspaceId, [tombstone]);
	// The deck's card type switches and its daily limits go with it; another
	// tab may have removed those rows already (a skipped tombstone is fine).
	for (const write of [studyDelete(snap, 'deckSettings', id), studyDelete(snap, 'limits', id)]) {
		if (write !== null) await pushOptional(workspaceId, write);
	}
}

/**
 * saveDeckCardTypes switches the opt-in card kinds of one deck (General
 * included) by rewriting its `deckcfg:` row. The stored row is re-read so
 * fields this version does not know survive.
 */
export async function saveDeckCardTypes(
	workspaceId: number,
	deckId: string,
	cardTypes: readonly OptInKind[],
): Promise<DeckSettings> {
	requireWorkspaceArg(workspaceId, 'saveDeckCardTypes');
	const { data: { deckSettings }, snapshot: snap } = await planningView(workspaceId);
	const stored = deckSettings?.[deckId];
	const next: DeckSettings = {
		deckId,
		cardTypes: cleanCardTypes(cardTypes),
		...(stored?.newOrder ? { newOrder: stored.newOrder } : {}),
		extra: stored?.extra ?? extraOf(snap, 'deckSettings', deckId),
	};
	const write = studyWrite(snap, 'deckSettings', settingsRow(next));
	if (write !== null) await pushStudy(workspaceId, [write]);
	return next;
}

/**
 * saveDeckCardTypesForDecks toggles one opt-in kind on every named deck in
 * one pull/push: the global card-type checkboxes on the setup page use it so
 * the decks agree before a session starts. Rows whose kinds are unchanged
 * are not written. A deck whose stored settings row this version cannot
 * read (#167) is left alone and listed in `unreadable`, so one such row
 * does not stop the others; `saved` holds the decks written or unchanged.
 */
export async function saveDeckCardTypesForDecks(
	workspaceId: number,
	deckIds: readonly string[],
	kind: OptInKind,
	on: boolean,
): Promise<{ saved: Record<string, DeckSettings>; unreadable: string[] }> {
	requireWorkspaceArg(workspaceId, 'saveDeckCardTypesForDecks');
	if (deckIds.length === 0) return { saved: {}, unreadable: [] };
	const { data: { deckSettings }, snapshot: snap } = await planningView(workspaceId);
	const out: Record<string, DeckSettings> = {};
	const unreadable: string[] = [];
	const writes: StudyWrite[] = [];
	for (const deckId of deckIds) {
		if (snap.unreadable.has(studyKey('deckSettings', deckId))) {
			unreadable.push(deckId);
			continue;
		}
		const stored = deckSettings?.[deckId];
		const current = cleanCardTypes(stored?.cardTypes ?? []);
		const nextTypes = on
			? cleanCardTypes([...current, kind])
			: current.filter((value) => value !== kind);
		const next: DeckSettings = {
			deckId,
			cardTypes: nextTypes,
			...(stored?.newOrder ? { newOrder: stored.newOrder } : {}),
			extra: stored?.extra ?? extraOf(snap, 'deckSettings', deckId),
		};
		out[deckId] = next;
		const write = studyWrite(snap, 'deckSettings', settingsRow(next));
		if (write !== null) writes.push(write);
	}
	if (writes.length > 0) await pushStudy(workspaceId, writes);
	return { saved: out, unreadable };
}

function withoutNewOrder(extra: Record<string, unknown>): Record<string, unknown> {
	const { newOrder: _dropped, ...rest } = extra;
	void _dropped;
	return rest;
}

/**
 * saveDeckNewOrder sets the order of new cards of one deck (#75) by
 * rewriting its `deckcfg:` row; card types and unknown fields survive.
 * `added` is stored as no field (the default).
 */
export async function saveDeckNewOrder(
	workspaceId: number,
	deckId: string,
	order: NewOrder,
): Promise<DeckSettings> {
	requireWorkspaceArg(workspaceId, 'saveDeckNewOrder');
	const { data: { deckSettings }, snapshot: snap } = await planningView(workspaceId);
	const stored = deckSettings?.[deckId];
	const next: DeckSettings = {
		deckId,
		cardTypes: stored?.cardTypes ?? [],
		...(order.by === 'added' ? {} : { newOrder: order }),
		// Choosing an order replaces an unreadable stored one too.
		extra: withoutNewOrder(stored?.extra ?? extraOf(snap, 'deckSettings', deckId)),
	};
	const write = studyWrite(snap, 'deckSettings', settingsRow(next));
	if (write !== null) await pushStudy(workspaceId, [write]);
	return next;
}

