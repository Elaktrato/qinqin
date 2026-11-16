// "Add to my decks": copy a system deck into a deck the learner owns. The
// plan is pure and idempotent, the write goes through one batch push
// (pushStudyRows). Rule and fixtures: docs/contracts/decks/add-to-deck.json.
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
// `deckcfg:` row with its new-card order only when no live row exists.

import { newCardId } from '$lib/study/canonical';
import { deckSettingsKey, serializeDeckSettings } from '$lib/study/deckSettings';
import type { NewOrder } from '$lib/study/newOrder';
import { GENERAL_DECK_ID, studyRowKey } from '$lib/study/store';
import type { Deck, StudyCard } from '$lib/study/types';

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
	/** The `deckcfg:` row to write (only with `settings` and no live row). */
	settings?: Record<string, unknown>;
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
}

export function planAddToDeck(input: AddInput): AddPlan {
	const { target, existingDeck, rawCards, now, exclude } = input;
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
				id: newCardId('vocab', item.entryId),
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

	const needsDeck = existingDeck === null && target.id !== GENERAL_DECK_ID;
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
		plan.settings = serializeDeckSettings(
			{ deckId: target.id, cardTypes: [], newOrder: input.settings.newOrder, extra: {} },
			now.toISOString()
		);
	}
	return plan;
}

/**
 * The rows to push for a plan: the deck row first, then its settings row, then the cards. `knownAt` (from
 * loadRawStudyData) lets the writer stamp each row after what the server holds.
 */
export function addPlanRows(
	plan: AddPlan,
	knownAt?: ReadonlyMap<string, string>
): { key: string; data: unknown; knownAt?: string }[] {
	const row = (key: string, data: unknown) => {
		const known = knownAt?.get(key);
		return known === undefined ? { key, data } : { key, data, knownAt: known };
	};
	return [
		...(plan.deck === null ? [] : [row(studyRowKey.deck(plan.deck.id), plan.deck)]),
		...(plan.settings === undefined
			? []
			: [row(deckSettingsKey(String(plan.settings.deckId)), plan.settings)]),
		...plan.writes.map((card) => row(studyRowKey.card(card.id), card))
	];
}
