// Companion cards are planned lazily. A vocab card has no sentence,
// writing or tone card until the user studies one: the session plans a
// virtual item, and the real card is created on its first grade (see
// gradeItem). Planning is pure; it never writes.

import { studyDay as utcDay, type StudyDay } from '../time/studyDay';
import { isValidReview, sortedReviews } from './scheduler';
import type { ReviewEvent, StudyCard, StudyCardKind } from './types';

export const COMPANION_PREFIX = 'companion:';

export type CompanionKind = 'sentence' | 'writing' | 'tone';

const COMPANION_KINDS: readonly CompanionKind[] = ['sentence', 'writing', 'tone'];

/** A not-yet-created card of `kind` for a vocab card's entry. */
export interface CompanionItem {
	cardId: string;
	kind: CompanionKind;
	entryId: number;
	/**
	 * The vocab card's written snapshot. Absent for cards added before
	 * snapshots existed (Round 1): the runner falls back to the entry, and
	 * gradeItem snapshots the entry's written form on creation.
	 */
	written?: string;
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
 * planCompanions returns one virtual item per vocab card in `deckIds`
 * (with or without a `written` snapshot) that has no card of that kind yet,
 * oldest vocab card first. At most `newBudget` items are returned in
 * total, taking one kind at a time in round-robin order so no kind
 * starves the others.
 */
export function planCompanions({
	cards,
	kinds,
	deckIds,
	newBudget,
	reviews = [],
	now = Date.now(),
	studyDay
}: {
	cards: readonly StudyCard[];
	kinds: readonly StudyCardKind[];
	deckIds: readonly string[];
	newBudget: number;
	/** Review history; character cards unlock writing from it. */
	reviews?: readonly ReviewEvent[];
	/** The clock in epoch ms, for the unlock. */
	now?: number;
	/** The learner's day; UTC when absent. */
	studyDay?: StudyDay;
}): CompanionItem[] {
	const budget = Number.isFinite(newBudget) ? Math.max(0, Math.floor(newBudget)) : 0;
	const wantedKinds = COMPANION_KINDS.filter((kind) => kinds.includes(kind));
	if (budget === 0 || wantedKinds.length === 0) return [];

	const decks = new Set(deckIds);
	const have = new Set(cards.filter((c) => c.kind !== 'vocab').map((c) => `${c.kind}:${c.entryId}`));
	const sources = cards
		.filter(
			(card) =>
				card.kind === 'vocab' && card.deckIds.some((id) => decks.has(id))
		)
		.sort(
			(a, b) =>
				createdAtMs(a) - createdAtMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
		);

	const day = studyDay ?? utcDay([]);
	const today = day.today(now);
	// A character's writing card unlocks the learner day after its
	// recognition card was first reviewed.
	const firstReview = new Map<string, number>();
	if (sources.some((card) => card.entryKind === 'character')) {
		for (const review of sortedReviews(reviews.filter(isValidReview))) {
			const id = review.payload.cardId;
			if (!firstReview.has(id)) firstReview.set(id, Date.parse(review.ts));
		}
	}
	const isPlannable = (card: StudyCard, kind: CompanionKind): boolean => {
		if (card.entryKind !== 'character') return true;
		if (kind !== 'writing') return false;
		const first = firstReview.get(card.id);
		return first !== undefined && day.dayOf(first) < today;
	};

	const perKind = wantedKinds.map((kind) => {
		const seen = new Set<number>();
		const items: CompanionItem[] = [];
		for (const card of sources) {
			if (have.has(`${kind}:${card.entryId}`) || seen.has(card.entryId)) continue;
			if (!isPlannable(card, kind)) continue;
			seen.add(card.entryId);
			const item: CompanionItem = {
				cardId: `${COMPANION_PREFIX}${kind}:${card.entryId}`,
				kind,
				entryId: card.entryId,
				deckIds: [...card.deckIds],
				virtual: true
			};
			if (typeof card.written === 'string' && card.written !== '') item.written = card.written;
			items.push(item);
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
