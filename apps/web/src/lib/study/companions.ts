// Companion cards are planned lazily. A vocab card has no sentence,
// writing or tone card until the user studies one: the session plans a
// virtual item, and the real card is created on its first grade (see
// gradeItem). Planning is pure; it never writes.

import type { StudyCard, StudyCardKind } from './types';

export const COMPANION_PREFIX = 'companion:';

export type CompanionKind = 'sentence' | 'writing' | 'tone';

const COMPANION_KINDS: readonly CompanionKind[] = ['sentence', 'writing', 'tone'];

/** A not-yet-created card of `kind` for a vocab card's entry. */
export interface CompanionItem {
	cardId: string;
	kind: CompanionKind;
	entryId: number;
	written: string;
	deckIds: string[];
	virtual: true;
}

export function isCompanionId(id: string): boolean {
	return id.startsWith(COMPANION_PREFIX);
}

function createdAtMs(card: StudyCard): number {
	const ms = Date.parse(card.createdAt);
	return Number.isNaN(ms) ? 0 : ms;
}

/**
 * planCompanions returns one virtual item per vocab card (in `deckIds`,
 * with a `written` snapshot) that has no card of the wanted kind yet,
 * oldest vocab card first. At most `newBudget` items are returned in
 * total, taking one kind at a time in round-robin order so no kind
 * starves the others.
 */
export function planCompanions({
	cards,
	kinds,
	deckIds,
	newBudget
}: {
	cards: readonly StudyCard[];
	kinds: readonly StudyCardKind[];
	deckIds: readonly string[];
	newBudget: number;
}): CompanionItem[] {
	const budget = Number.isFinite(newBudget) ? Math.max(0, Math.floor(newBudget)) : 0;
	const wantedKinds = COMPANION_KINDS.filter((kind) => kinds.includes(kind));
	if (budget === 0 || wantedKinds.length === 0) return [];

	const decks = new Set(deckIds);
	const have = new Set(cards.filter((c) => c.kind !== 'vocab').map((c) => `${c.kind}:${c.entryId}`));
	const sources = cards
		.filter(
			(card) =>
				card.kind === 'vocab' &&
				typeof card.written === 'string' &&
				card.written !== '' &&
				card.deckIds.some((id) => decks.has(id))
		)
		.sort(
			(a, b) =>
				createdAtMs(a) - createdAtMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
		);

	const perKind = wantedKinds.map((kind) => {
		const seen = new Set<number>();
		const items: CompanionItem[] = [];
		for (const card of sources) {
			if (have.has(`${kind}:${card.entryId}`) || seen.has(card.entryId)) continue;
			seen.add(card.entryId);
			items.push({
				cardId: `${COMPANION_PREFIX}${kind}:${card.entryId}`,
				kind,
				entryId: card.entryId,
				written: card.written as string,
				deckIds: [...card.deckIds],
				virtual: true
			});
		}
		return items;
	});

	const planned: CompanionItem[] = [];
	for (let round = 0; planned.length < budget; round++) {
		let added = false;
		for (const items of perKind) {
			if (round < items.length && planned.length < budget) {
				planned.push(items[round]);
				added = true;
			}
		}
		if (!added) break;
	}
	return planned;
}
