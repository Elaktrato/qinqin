// One card per thing studied, even across devices. New cards get an id
// derived from what they teach (`newCardId`), so two devices that add the
// same card at the same moment write the same plugin-data key and sync's
// last-write-wins leaves one row. Cards created before that (ULID ids)
// can still exist twice; `canonicalCards` merges them at read time:
// per `cardKey` the earliest-created card survives and the reviews of the
// others count for it. Stored data is never rewritten.

import { cardKey } from './reviewParse';
import { CARD_KINDS, type ReviewEvent, type StudyCard, type StudyCardKind } from './types';

/**
 * newCardId is the deterministic id of a new card: `c-<kind>-<entryId>`.
 * Sentence cards use `c-sentence-<entryId>` too (one sentence card per
 * word); addCard picks another id if that one is already taken by a card
 * about a different sentence. Only [a-z0-9-] appear, so the id is safe in
 * a plugin-data key and in the URL path segment that carries it.
 */
export function newCardId(kind: StudyCardKind, entryId: number): string {
	return `c-${kind}-${entryId}`;
}

/** The known, non-vocab kinds of a list, deduplicated, in kind order. */
export function cleanSkipKinds(list: readonly unknown[]): StudyCardKind[] {
	return CARD_KINDS.filter((kind) => kind !== 'vocab' && list.includes(kind));
}

function createdAtMs(card: StudyCard): number {
	const ms = Date.parse(card.createdAt);
	// An unparsable time never wins against a real one.
	return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** compareCanonical orders cards so the survivor of a duplicate set comes first. */
export function compareCanonical(a: StudyCard, b: StudyCard): number {
	const byTime = createdAtMs(a) - createdAtMs(b);
	if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** keyOf is the dedupe key of a stored card. */
export function keyOf(card: StudyCard): string {
	return cardKey(card.kind, card.entryId, card.sentenceId);
}

/**
 * mergeInto returns the survivor enriched by its duplicates: it stays in
 * every deck any of them was in (a card added to a deck on another device
 * must not vanish from that deck), and a missing written snapshot or
 * sentence is taken from the oldest duplicate that has one. The
 * survivor's own fields always win.
 */
function mergeInto(survivor: StudyCard, others: readonly StudyCard[]): StudyCard {
	const merged: StudyCard = { ...survivor, deckIds: [...survivor.deckIds] };
	for (const other of others) {
		for (const deckId of other.deckIds) {
			if (!merged.deckIds.includes(deckId)) merged.deckIds.push(deckId);
		}
		if (merged.written === undefined && other.written !== undefined) {
			merged.written = other.written;
		}
		if (merged.entryKind === undefined && other.entryKind !== undefined) {
			merged.entryKind = other.entryKind;
		}
		if (merged.sentenceId === undefined && other.sentenceId !== undefined) {
			merged.sentenceId = other.sentenceId;
		}
		if (other.skipKinds !== undefined) {
			const union = cleanSkipKinds([...(merged.skipKinds ?? []), ...other.skipKinds]);
			if (union.length > 0) merged.skipKinds = union;
		}
	}
	return merged;
}

export interface CanonicalStudy {
	cards: StudyCard[];
	reviews: ReviewEvent[];
	/** How many duplicate cards were folded into a survivor. */
	merged: number;
}

/**
 * canonicalCards merges duplicate cards (same `cardKey`). Per key the
 * earliest `createdAt` survives (ties: the lowest id); the survivor keeps
 * its position in `cards`, the duplicates drop out, and reviews of a
 * duplicate are re-pointed to the survivor (a copy: event ids and the
 * inputs are untouched). Pure and idempotent; inputs without duplicates
 * come back as they are.
 */
export function canonicalCards(
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[]
): CanonicalStudy {
	const groups = new Map<string, StudyCard[]>();
	for (const card of cards) {
		const key = keyOf(card);
		const group = groups.get(key);
		if (group === undefined) groups.set(key, [card]);
		else group.push(card);
	}

	// Duplicate card id -> survivor id; survivor id -> merged survivor.
	const redirect = new Map<string, string>();
	const survivors = new Map<string, StudyCard>();
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const [survivor, ...others] = [...group].sort(compareCanonical);
		survivors.set(survivor.id, mergeInto(survivor, others));
		for (const other of others) {
			if (other.id !== survivor.id) redirect.set(other.id, survivor.id);
		}
	}

	if (survivors.size === 0) {
		return { cards: [...cards], reviews: [...reviews], merged: 0 };
	}

	const kept: StudyCard[] = [];
	const emitted = new Set<string>();
	for (const card of cards) {
		if (redirect.has(card.id)) continue;
		// The same id twice in the input (should not happen) is one card.
		if (survivors.has(card.id)) {
			if (emitted.has(card.id)) continue;
			emitted.add(card.id);
			kept.push(survivors.get(card.id)!);
		} else {
			kept.push(card);
		}
	}

	const repointed = reviews.map((review) => {
		const target = redirect.get(review.payload.cardId);
		if (target === undefined) return review;
		return { ...review, payload: { ...review.payload, cardId: target } };
	});

	return { cards: kept, reviews: repointed, merged: cards.length - kept.length };
}
