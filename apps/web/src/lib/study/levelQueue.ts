// A level session draws its words from one level of a level scheme. Some
// of those words may already have a study card; the rest are "virtual":
// they have no card row until the user grades one, at which point the
// runner creates the card. The queue is therefore a mix of real card ids
// and stable virtual ids, never duplicate entries.

import { studyDay as utcStudyDay, type StudyDay } from '../time/studyDay';
import { backfillLimit } from './cardFlow';
import { isDue, isValidReview, scheduleFor, sortedReviews } from './scheduler';
import type { ReviewEvent, StudyCard, StudyCardKind } from './types';

export type LevelUnit = 'word' | 'character';

/** The card kinds a character level studies: recognition, then writing. */
export const CHARACTER_KINDS: readonly StudyCardKind[] = ['vocab', 'writing'];

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
	kind: StudyCardKind;
}

export interface BuildLevelQueueOptions {
	entries: readonly LevelEntry[];
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	newLimit: number;
	reviewLimit: number;
	now: Date;
	/** The workspace's active FSRS weights. */
	w: readonly number[];
	/** The scheme's unit; words by default. */
	unit?: LevelUnit;
	/** Selected card kinds; vocab only by default. Word levels ignore all but vocab. */
	kinds?: readonly StudyCardKind[];
	/** The learner's day for the writing unlock; UTC when absent (callers pass currentStudyDay()). */
	studyDay?: StudyDay;
	/** How many extra new items to keep as reserve; defaults to backfillLimit(newLimit). */
	reserve?: number;
}

/** A level session: the queue plus new items held back for dropped ones. */
export interface LevelPlan {
	queue: LevelQueueItem[];
	reserve: LevelQueueItem[];
}

/** The id of an item whose card does not exist yet. */
export function virtualLevelId(kind: StudyCardKind, entryId: number): string {
	return kind === 'vocab'
		? `${VIRTUAL_CARD_PREFIX}${entryId}`
		: `${VIRTUAL_CARD_PREFIX}${kind}:${entryId}`;
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
export function buildLevelQueue(options: BuildLevelQueueOptions): LevelQueueItem[] {
	return buildLevelPlan(options).queue;
}

/** buildLevelPlan is the session's entry point: queue and reserve. */
export function buildLevelPlan(options: BuildLevelQueueOptions): LevelPlan {
	return (options.unit ?? 'word') === 'character'
		? buildCharacterPlan(options)
		: buildWordPlan(options);
}

function reserveSize(options: BuildLevelQueueOptions): number {
	return options.reserve === undefined ? backfillLimit(options.newLimit) : cap(options.reserve);
}

function buildWordPlan(options: BuildLevelQueueOptions): LevelPlan {
	const { entries, cards, reviews, newLimit, reviewLimit, now, w } = options;
	if (options.kinds !== undefined && !options.kinds.includes('vocab')) {
		return { queue: [], reserve: [] };
	}
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
				virtual: true,
				kind: 'vocab'
			});
			continue;
		}

		const schedule = scheduleFor(card.id, reviews, now, w);
		if (schedule === null) {
			// A card that was added to study but never graded is new, just
			// like in a deck session; keep its real id.
			fresh.push({ cardId: card.id, entryId: entry.id, virtual: false, kind: 'vocab' });
			continue;
		}
		if (!isDue(schedule, now)) continue;
		due.push({
			item: { cardId: card.id, entryId: entry.id, virtual: false, kind: 'vocab' },
			at: instant(schedule.due)
		});
	}

	due.sort((a, b) => a.at - b.at || a.item.entryId - b.item.entryId);
	fresh.sort((a, b) => a.entryId - b.entryId);

	const fresher = [...fresh, ...virtual];
	const limit = cap(newLimit);
	return {
		queue: [
			...due.slice(0, cap(reviewLimit)).map((entry) => entry.item),
			...fresher.slice(0, limit)
		],
		reserve: fresher.slice(limit, limit + reserveSize(options))
	};
}

function sameCardOrder(a: StudyCard, b: StudyCard): number {
	const ta = Date.parse(a.createdAt);
	const tb = Date.parse(b.createdAt);
	const byTime = (Number.isNaN(ta) ? Infinity : ta) - (Number.isNaN(tb) ? Infinity : tb);
	if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Character levels: recognition (`vocab`) and writing cards per character.
 * Writing, when both kinds are selected, is new only once the recognition
 * card was first reviewed on an earlier learner day.
 */
function buildCharacterPlan(options: BuildLevelQueueOptions): LevelPlan {
	const { entries, cards, reviews, newLimit, reviewLimit, now, w } = options;
	const wanted = CHARACTER_KINDS.filter((kind) => (options.kinds ?? ['vocab']).includes(kind));
	if (wanted.length === 0) return { queue: [], reserve: [] };
	const day = options.studyDay ?? utcStudyDay([]);
	const today = day.today(now.getTime());
	const gated = wanted.includes('vocab') && wanted.includes('writing');

	const cardByKey = new Map<string, StudyCard>();
	for (const card of [...cards].sort(sameCardOrder)) {
		const key = `${card.kind}:${card.entryId}`;
		if (!cardByKey.has(key)) cardByKey.set(key, card);
	}
	const firstReviewMs = new Map<string, number>();
	for (const review of sortedReviews(reviews.filter(isValidReview))) {
		const id = review.payload.cardId;
		if (!firstReviewMs.has(id)) firstReviewMs.set(id, instant(review.ts));
	}

	const seen = new Set<number>();
	const due: { item: LevelQueueItem; at: number }[] = [];
	const freshWriting: LevelQueueItem[] = [];
	const freshVocab: LevelQueueItem[] = [];

	for (const entry of entries) {
		if (entry.kind !== 'character' || seen.has(entry.id)) continue;
		seen.add(entry.id);

		for (const kind of wanted) {
			const card = cardByKey.get(`${kind}:${entry.id}`);
			const target = kind === 'writing' ? freshWriting : freshVocab;
			if (kind === 'writing' && gated && !(card !== undefined && firstReviewMs.has(card.id))) {
				const recognition = cardByKey.get(`vocab:${entry.id}`);
				const first = recognition === undefined ? undefined : firstReviewMs.get(recognition.id);
				if (first === undefined || day.dayOf(first) >= today) continue;
			}
			if (card === undefined) {
				target.push({
					cardId: virtualLevelId(kind, entry.id),
					entryId: entry.id,
					virtual: true,
					kind
				});
				continue;
			}
			const schedule = scheduleFor(card.id, reviews, now, w);
			if (schedule === null) {
				target.push({ cardId: card.id, entryId: entry.id, virtual: false, kind });
				continue;
			}
			if (!isDue(schedule, now)) continue;
			due.push({
				item: { cardId: card.id, entryId: entry.id, virtual: false, kind },
				at: instant(schedule.due)
			});
		}
	}

	due.sort((a, b) => a.at - b.at);
	const fresh = [...freshWriting, ...freshVocab];
	const limit = cap(newLimit);
	return {
		queue: [
			...due.slice(0, cap(reviewLimit)).map((entry) => entry.item),
			...fresh.slice(0, limit)
		],
		reserve: fresh.slice(limit, limit + reserveSize(options))
	};
}
