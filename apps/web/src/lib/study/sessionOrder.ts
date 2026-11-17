// The new-card key of a session (#75): resolves the setup's order against
// the decks' own orders and what is installed, then loads ranks or level
// keys for the entries that can be new. Offline, or when a request fails,
// the session keeps the order added and says so.

import type { FrequencyPack, Scheme } from '$lib/api/types';
import type { LevelUnit } from './levelQueue';
import { resolveSessionOrder, type NewOrder, type SessionNewOrder } from './newOrder';
import { mixedNote, offlineNote, resolveAvailableOrder } from './newOrderView';
import type { RanksResult } from './frequencyRanks';
import { isValidReview } from './scheduler';
import type { ReviewEvent, StudyCard, StudyCardKind } from './types';
import type { DeckSettings } from './deckSettings';
import { GENERAL_DECK_ID } from './store';

export interface SessionKeyDeps {
	packs: () => Promise<FrequencyPack[]>;
	schemes: () => Promise<Scheme[]>;
	ranks: (language: string, entryIds: readonly number[]) => Promise<RanksResult>;
	levelKeys: (scheme: Scheme) => Promise<(entryId: number) => number | null>;
}

export interface SessionKeyInput {
	mode: 'decks' | 'levels';
	order: SessionNewOrder;
	language: string;
	/** Decks mode: the selected decks' own orders (null = added). */
	deckOrders?: readonly (NewOrder | null)[];
	/** Levels mode: the scheme's unit; frequency ranks words only. */
	levelUnit?: LevelUnit;
	/** The entries whose items can be new (candidateNewEntries). */
	newEntryIds: readonly number[];
	online: boolean;
}

export interface SessionKey {
	key: ((entryId: number) => number | null) | null;
	note: string | null;
}

/** sessionNewKey: the key for the session's new items, or null for the order it already has. */
export async function sessionNewKey(
	input: SessionKeyInput,
	deps: SessionKeyDeps
): Promise<SessionKey> {
	let order: NewOrder;
	let note: string | null = null;
	if (input.mode === 'levels') {
		// Level sessions keep level order unless the setup asks for frequency on words.
		if (input.order === 'deck' || input.order.by !== 'frequency' || input.levelUnit !== 'word') {
			return { key: null, note: null };
		}
		order = input.order;
	} else {
		const resolved = resolveSessionOrder(input.order, input.deckOrders ?? []);
		if (resolved.mixed) note = mixedNote();
		order = resolved.order;
	}
	if (order.by === 'added') return { key: null, note };
	if (!input.online) return { key: null, note: offlineNote() };
	try {
		const [packs, schemes] = await Promise.all([
			order.by === 'frequency' ? deps.packs() : Promise.resolve([]),
			order.by === 'level' ? deps.schemes() : Promise.resolve([])
		]);
		const available = resolveAvailableOrder(order, { language: input.language, packs, schemes });
		if (available.order.by === 'added') return { key: null, note: available.note };
		if (order.by === 'level') {
			const packId = order.packId;
			const scheme = schemes.find((s) => s.packId === packId) as Scheme;
			return { key: await deps.levelKeys(scheme), note: null };
		}
		const ranks = await deps.ranks(input.language, input.newEntryIds);
		return { key: ranks.rankOf, note: null };
	} catch {
		return { key: null, note: offlineNote() };
	}
}

/**
 * candidateNewEntries lists the entries whose items can be new, so ranks
 * are asked only for those: in decks mode the entries of never-reviewed
 * cards of the selected decks; in levels mode the level entries lacking a
 * reviewed card of some selected kind.
 */
export function candidateNewEntries(input: {
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	deckIds?: readonly string[];
	entries?: readonly number[];
	kinds?: readonly StudyCardKind[];
}): number[] {
	const reviewed = new Set<string>();
	for (const review of input.reviews)
		if (isValidReview(review)) reviewed.add(review.payload.cardId);
	if (input.entries === undefined) {
		const decks = new Set(input.deckIds ?? []);
		const out = new Set<number>();
		for (const card of input.cards) {
			if (!reviewed.has(card.id) && card.deckIds.some((id) => decks.has(id))) out.add(card.entryId);
		}
		return [...out];
	}
	const kinds = input.kinds ?? ['vocab'];
	const done = new Set<string>();
	for (const card of input.cards)
		if (reviewed.has(card.id)) done.add(`${card.kind}:${card.entryId}`);
	return [...new Set(input.entries)].filter((id) =>
		kinds.some((kind) => !done.has(`${kind}:${id}`))
	);
}

/**
 * deckOrdersOf: the own orders of the selected decks that still exist
 * (General always does), so a deleted deck in a saved setup never makes
 * the orders "mixed".
 */
export function deckOrdersOf(
	deckIds: readonly string[],
	decks: readonly { id: string }[],
	settings: Readonly<Record<string, DeckSettings>> | undefined
): (NewOrder | null)[] {
	const existing = new Set([GENERAL_DECK_ID, ...decks.map((deck) => deck.id)]);
	return deckIds.filter((id) => existing.has(id)).map((id) => settings?.[id]?.newOrder ?? null);
}
