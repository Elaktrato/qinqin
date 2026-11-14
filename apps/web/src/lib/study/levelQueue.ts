// A level session draws its words from one level of a level scheme. Some
// of those words may already have a study card; the rest are "virtual":
// they have no card row until the user grades one, at which point the
// runner creates the card. The queue is therefore a mix of real card ids
// and stable virtual ids, never duplicate entries.

import { isDue, scheduleFor } from './scheduler';
import type { ReviewEvent, StudyCard } from './types';

/** The fields of an entry a level queue needs. */
export interface LevelEntry {
	id: number;
	kind: string;
}

/**
 * One item of a level session. `virtual` marks an item whose card is
 * created on the first grade; `cardId` is then `level:<entryId>`.
 */
export interface LevelQueueItem {
	cardId: string;
	entryId: number;
	virtual: boolean;
}

export interface BuildLevelQueueOptions {
	entries: readonly LevelEntry[];
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	newLimit: number;
	reviewLimit: number;
	now: Date;
}

function instant(ts: string): number {
	const ms = Date.parse(ts);
	return Number.isNaN(ms) ? 0 : ms;
}

function cap(limit: number): number {
	if (!Number.isFinite(limit)) return 0;
	return Math.max(0, Math.floor(limit));
}

/** The prefix of an item that still needs a card row. */
export const VIRTUAL_CARD_PREFIX = 'level:';

/**
 * buildLevelQueue assembles one level session: existing vocab cards that
 * are due first, earliest due first, then the new bucket. The new bucket
 * holds existing cards that have never been reviewed (real card ids)
 * ordered by entry id, followed by word entries that have no card yet
 * (virtual ids) in level order; the two share one `newLimit`. Reviewed
 * cards that are not due yet are omitted. Non-word entries (derived
 * characters, sentences) never become cards.
 */
export function buildLevelQueue({
	entries,
	cards,
	reviews,
	newLimit,
	reviewLimit,
	now
}: BuildLevelQueueOptions): LevelQueueItem[] {
	// One card per entry is the store's invariant; if legacy data has
	// several, the smallest id keeps the queue stable across loads.
	const cardByEntry = new Map<number, StudyCard>();
	for (const card of [...cards]
		.filter((candidate) => candidate.kind === 'vocab')
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
		if (!cardByEntry.has(card.entryId)) cardByEntry.set(card.entryId, card);
	}

	const seen = new Set<number>();
	const due: { item: LevelQueueItem; at: number }[] = [];
	const fresh: LevelQueueItem[] = [];
	const virtual: LevelQueueItem[] = [];

	for (const entry of entries) {
		if (entry.kind !== 'word' || seen.has(entry.id)) continue;
		seen.add(entry.id);

		const card = cardByEntry.get(entry.id);
		if (card === undefined) {
			virtual.push({
				cardId: `${VIRTUAL_CARD_PREFIX}${entry.id}`,
				entryId: entry.id,
				virtual: true
			});
			continue;
		}

		const schedule = scheduleFor(card.id, reviews, now);
		if (schedule === null) {
			// A card that was added to study but never graded is new, just
			// like in a deck session; keep its real id.
			fresh.push({ cardId: card.id, entryId: entry.id, virtual: false });
			continue;
		}
		if (!isDue(schedule, now)) continue;
		due.push({
			item: { cardId: card.id, entryId: entry.id, virtual: false },
			at: instant(schedule.due)
		});
	}

	due.sort((a, b) => a.at - b.at || a.item.entryId - b.item.entryId);
	fresh.sort((a, b) => a.entryId - b.entryId);

	return [
		...due.slice(0, cap(reviewLimit)).map((entry) => entry.item),
		...[...fresh, ...virtual].slice(0, cap(newLimit))
	];
}
