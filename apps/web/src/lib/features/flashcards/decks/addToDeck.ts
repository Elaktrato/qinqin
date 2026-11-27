// "Add to my decks": copy a system deck into a deck the learner owns. The
// plan is pure and idempotent, the write goes through one batch push of
// typed study rows (pushStudy). Rule and fixtures: docs/contracts/decks/add-to-deck.json.
//
// Per item, in level order:
//  - no live vocab card -> create `c-vocab-<entryId>` (the id of a deleted
//    word, so its history revives) with createdAt = now + i ms, which keeps
//    the new cards in level order;
//  - a live vocab card, not in the target on every stored row -> join: the
//    target is appended to every stored row of the word (duplicates and
//    siblings follow their word);
//  - otherwise skip.
// The deck row is written only when no live row with the id exists: a
// rename survives re-adding, a tombstoned copy is revived.
//
// Starter decks (#75): `exclude` leaves known words out before planning
// (counted as `known`, never written), and `settings` writes the copy's
// deck settings row with its new-card order only when no live row exists.
//
// Rows this version cannot read (#167, docs/contracts/sync/README.md "Reading
// rows"; `unreadable`) are never written: a new card whose id one of them
// holds takes the next free id (freshCardId), and the deck or settings row of
// an unreadable identity is left alone and counted in `unreadable`. Cards
// still join the target (its deck row exists on the server).

import { newCardId } from '$lib/studycore/canonical';
import type { DeckSettings } from '$lib/studycore/deckSettings';
import type { NewOrder } from '$lib/studycore/newOrder';
import { cardRow, deckRow, settingsRow, studyKey } from '$lib/studycore/rows';
import { extraOf, freshCardId, studyWrite, type StudySnapshot, type StudyWrite } from '$lib/studycore/plan';
import { GENERAL_DECK_ID } from '$lib/studycore/types';
import type { Deck, StudyCard } from '$lib/studycore/types';

export interface AddItem {
	entryId: number;
	written: string;
	/** Set for the items of a character level: no sentence or tone companions follow. */
	entryKind?: 'character';
}

export interface AddPlan {
	/** The deck row to write; null when the target exists (or is General). */
	deck: Deck | null;
	writes: StudyCard[];
	created: number;
	joined: number;
	skipped: number;
	/** Items left out as known (set when `exclude` is given). */
	known?: number;
	/** The deck settings row to write (only with `settings` and no live row). */
	settings?: DeckSettings;
	/** Deck or settings rows left alone because this version cannot read the stored row (set when > 0). */
	unreadable?: number;
}

export interface AddInput {
	items: readonly AddItem[];
	target: { id: string; name: string; source?: Deck['source'] };
	/** The live deck row with the target's id, if any. */
	existingDeck: Deck | null;
	/** Every live stored card row, duplicates included (loadRawStudyData). */
	rawCards: readonly StudyCard[];
	now: Date;
	/** Entry ids never added (known words); they are counted in `known`. */
	exclude?: ReadonlySet<number>;
	/** The copy's new-card order; written only when `exists` is false. */
	settings?: { newOrder: NewOrder; exists: boolean };
	/** Keys of stored rows this version cannot read (StudySnapshot.unreadable): never written. */
	unreadable?: ReadonlySet<string>;
}

export function planAddToDeck(input: AddInput): AddPlan {
	const { target, existingDeck, rawCards, now, exclude } = input;
	const unreadable = input.unreadable ?? new Set<string>();
	let leftAlone = 0;
	const items = exclude === undefined ? input.items : input.items.filter((item) => !exclude.has(item.entryId));
	const base = now.getTime();
	const byEntry = new Map<number, StudyCard[]>();
	for (const card of rawCards) {
		const list = byEntry.get(card.entryId);
		if (list === undefined) byEntry.set(card.entryId, [card]);
		else list.push(card);
	}

	const writes: StudyCard[] = [];
	let created = 0;
	let joined = 0;
	let skipped = 0;
	items.forEach((item, i) => {
		const rows = byEntry.get(item.entryId) ?? [];
		const vocab = rows.filter((row) => row.kind === 'vocab');
		if (vocab.length === 0) {
			const card: StudyCard = {
				id: unreadable.has(studyKey('cards', newCardId('vocab', item.entryId)))
					? freshCardId(rawCards, unreadable, 'vocab', item.entryId)
					: newCardId('vocab', item.entryId),
				kind: 'vocab',
				entryId: item.entryId,
				written: item.written,
				deckIds: [target.id],
				createdAt: new Date(base + i).toISOString()
			};
			if (item.entryKind === 'character') card.entryKind = 'character';
			writes.push(card);
			created += 1;
			return;
		}
		if (vocab.every((row) => row.deckIds.includes(target.id))) {
			skipped += 1;
			return;
		}
		for (const row of rows) {
			if (!row.deckIds.includes(target.id)) {
				writes.push({ ...row, deckIds: [...row.deckIds, target.id] });
			}
		}
		joined += 1;
	});

	const deckUnreadable = unreadable.has(studyKey('decks', target.id));
	if (existingDeck === null && target.id !== GENERAL_DECK_ID && deckUnreadable) leftAlone += 1;
	const needsDeck = existingDeck === null && target.id !== GENERAL_DECK_ID && !deckUnreadable;
	const deck: Deck | null = needsDeck
		? {
				id: target.id,
				name: target.name,
				createdAt: now.toISOString(),
				...(target.source === undefined ? {} : { source: target.source })
			}
		: null;
	const plan: AddPlan = { deck, writes, created, joined, skipped };
	if (exclude !== undefined) plan.known = input.items.length - items.length;
	if (input.settings !== undefined && !input.settings.exists && target.id !== GENERAL_DECK_ID) {
		if (unreadable.has(studyKey('deckSettings', target.id))) leftAlone += 1;
		else plan.settings = {
			deckId: target.id,
			cardTypes: [],
			newOrder: input.settings.newOrder,
			extra: {}
		};
	}
	if (leftAlone > 0) plan.unreadable = leftAlone;
	return plan;
}

/**
 * The typed writes for a plan: the deck row first, then its settings row, then the cards. `stored` (from
 * loadRawStudyData) lets each write be stamped after what the server holds and echo the stored `extra`.
 */
export function addPlanRows(plan: AddPlan, stored?: Partial<StudySnapshot>): StudyWrite[] {
	const writes = [
		...(plan.deck === null ? [] : [studyWrite(stored, 'decks', deckRow(plan.deck, extraOf(stored, 'decks', plan.deck.id)))]),
		...(plan.settings === undefined ? [] : [studyWrite(stored, 'deckSettings', settingsRow(plan.settings))]),
		...plan.writes.map((card) => studyWrite(stored, 'cards', cardRow(card, extraOf(stored, 'cards', card.id))))
	];
	return writes.filter((w): w is StudyWrite => w !== null);
}
