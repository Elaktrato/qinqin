// A level session draws its words from one level of a level scheme. Some
// of those words may already have a study card; the rest are "virtual":
// they have no card row until the user grades one, at which point the
// runner creates the card. The queue is therefore a mix of real card ids
// and stable virtual ids, never duplicate entries.

import { t } from '$lib/i18n';
import { compareCanonical } from '$lib/studycore/canonical';
import { buildSessionQueue, skipKindsByEntry, type QueueEntry } from './sessionQueue';
import { isValidReview, scheduleFor, sortedReviews } from '$lib/studycore/scheduler';
import { orderNew } from '$lib/studycore/newOrder';
import { dayCountsCached, NO_LIMIT, type Candidate } from '$lib/studycore/limits';
import { isDueNow, type StudyContext } from '$lib/studycore/studyContext';
import { GENERAL_DECK_ID, type ReviewEvent, type StudyCard, type StudyCardKind } from '$lib/studycore/types';

export type LevelUnit = 'word' | 'character';

/** The card kinds a character level studies: recognition, then writing. */
export const CHARACTER_KINDS: readonly StudyCardKind[] = ['vocab', 'writing'];

/** The fields of an entry a level queue needs. */
export interface LevelEntry {
	id: number;
	kind: string;
	/** The glyph; lets a character level check stroke data. */
	written?: string;
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
	/** The learner's day (writing unlock), the study clock and vacation state. */
	ctx: StudyContext;
	/** `kind:entryId` keys of virtual items already found ineligible (never planned). */
	skip?: ReadonlySet<string>;
	/**
	 * Whether a glyph has stroke data (`hasStrokeData`). A character level
	 * plans no writing item for a glyph where it is false; recognition is
	 * unaffected. Absent: every glyph qualifies.
	 */
	hasStrokes?: (glyph: string) => boolean;
	/**
	 * Entries left out entirely (neither their card nor a virtual item), so a
	 * buried word never uses a limit slot; the next word takes it.
	 */
	excludeEntries?: ReadonlySet<number>;
	/**
	 * The new-item order (#75): a key per entry, lower first, null after
	 * every keyed item (orderNew). A word plan orders its whole new bucket
	 * (real and virtual); a character plan orders inside the writing and
	 * the recognition group. Absent: level order.
	 */
	newKey?: (entryId: number) => number | null;
	/** Ignore the session and deck daily limits (the owner's Study all). */
	studyAll?: boolean;
}

/** A level session: the queue plus new items held back for dropped ones. */
export interface LevelPlan {
	queue: LevelQueueItem[];
	reserve: LevelQueueItem[];
	/** Replacements from the reserve left this session (sessionQueue.ts). */
	backfillLeft: number;
}

/** A level's candidates before admission: the due items in due order, then the new ones. */
interface LevelCandidates {
	due: LevelQueueItem[];
	fresher: LevelQueueItem[];
}

const NO_CANDIDATES: LevelCandidates = { due: [], fresher: [] };

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

/** buildLevelPlan is the session's entry point: queue, reserve and backfill bound. */
export function buildLevelPlan(options: BuildLevelQueueOptions): LevelPlan {
	return admitPlan(options, levelCandidates(options));
}

function levelCandidates(options: BuildLevelQueueOptions): LevelCandidates {
	return (options.unit ?? 'word') === 'character' ? characterCandidates(options) : wordCandidates(options);
}

function wordCandidates(options: BuildLevelQueueOptions): LevelCandidates {
	const { entries, cards, reviews, now, w } = options;
	if (options.kinds !== undefined && !options.kinds.includes('vocab')) return NO_CANDIDATES;
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
		if (options.excludeEntries?.has(entry.id)) continue;
		seen.add(entry.id);

		const card = cardByEntry.get(entry.id);
		if (card === undefined) {
			virtual.push({
				cardId: virtualLevelId('vocab', entry.id),
				entryId: entry.id,
				virtual: true,
				kind: 'vocab'
			});
			continue;
		}

		const schedule = scheduleFor(card.id, reviews, now, w, options.ctx.clock);
		if (schedule === null) {
			// A card that was added to study but never graded is new, just
			// like in a deck session; keep its real id.
			fresh.push({ cardId: card.id, entryId: entry.id, virtual: false, kind: 'vocab' });
			continue;
		}
		if (!isDueNow(schedule, now, options.ctx)) continue;
		due.push({
			item: { cardId: card.id, entryId: entry.id, virtual: false, kind: 'vocab' },
			at: instant(schedule.due)
		});
	}

	due.sort((a, b) => a.at - b.at || a.item.entryId - b.item.entryId);
	fresh.sort((a, b) => a.entryId - b.entryId);

	return { due: due.map((entry) => entry.item), fresher: ordered(options, [...fresh, ...virtual]) };
}

/** ordered applies the session's new-item key, if any. */
function ordered(options: BuildLevelQueueOptions, items: LevelQueueItem[]): LevelQueueItem[] {
	const key = options.newKey;
	return key === undefined ? items : orderNew(items, (item) => key(item.entryId));
}

/**
 * levelEntries are a level's candidates for the shared builder
 * (sessionQueue.ts): existing cards count against their own decks, virtual
 * items against `general`.
 */
function levelEntries(options: BuildLevelQueueOptions, { due, fresher }: LevelCandidates): QueueEntry<LevelQueueItem>[] {
	const { cards, reviews, ctx, now } = options;
	const counts = dayCountsCached(cards, reviews, ctx, now);
	const decksOf = new Map(cards.map((card) => [card.id, card.deckIds]));
	const entry = (item: LevelQueueItem, bucket: Candidate['bucket']): QueueEntry<LevelQueueItem> => ({
		cardId: item.cardId,
		deckIds: item.virtual ? [GENERAL_DECK_ID] : (decksOf.get(item.cardId) ?? [GENERAL_DECK_ID]),
		bucket,
		item
	});
	return [
		...due.map((item) => entry(item, counts.reviewedToday.has(item.cardId) ? 'continuing' : 'review')),
		...fresher.map((item) => entry(item, 'new'))
	];
}

/** admitPlan runs the shared builder over a level's candidates. */
function admitPlan(options: BuildLevelQueueOptions, candidates: LevelCandidates): LevelPlan {
	const { cards, reviews, ctx, now } = options;
	return buildSessionQueue({
		entries: levelEntries(options, candidates),
		ctx,
		counts: dayCountsCached(cards, reviews, ctx, now),
		caps: { newLimit: options.newLimit, reviewLimit: options.reviewLimit },
		studyAll: options.studyAll === true
	});
}

/**
 * Character levels: recognition (`vocab`) and writing cards per character.
 * Writing, when both kinds are selected, is new only once the recognition
 * card was first reviewed on an earlier learner day.
 */
function characterCandidates(options: BuildLevelQueueOptions): LevelCandidates {
	const { entries, cards, reviews, now, w } = options;
	const wanted = CHARACTER_KINDS.filter((kind) => (options.kinds ?? ['vocab']).includes(kind));
	if (wanted.length === 0) return NO_CANDIDATES;
	// A kind the learner removed for a character (its vocab row's skipKinds) is never planned.
	const removed = skipKindsByEntry(cards);
	const day = options.ctx.day;
	const today = day.today(now.getTime());
	const gated = wanted.includes('vocab') && wanted.includes('writing');

	const cardByKey = new Map<string, StudyCard>();
	for (const card of [...cards].sort(compareCanonical)) {
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
		if (options.excludeEntries?.has(entry.id)) continue;
		seen.add(entry.id);

		for (const kind of wanted) {
			if (removed.get(entry.id)?.has(kind)) continue;
			if (
				kind === 'writing' &&
				entry.written !== undefined &&
				options.hasStrokes !== undefined &&
				!options.hasStrokes(entry.written)
			) {
				continue;
			}
			const card = cardByKey.get(`${kind}:${entry.id}`);
			const target = kind === 'writing' ? freshWriting : freshVocab;
			if (kind === 'writing' && gated && !(card !== undefined && firstReviewMs.has(card.id))) {
				const recognition = cardByKey.get(`vocab:${entry.id}`);
				const first = recognition === undefined ? undefined : firstReviewMs.get(recognition.id);
				if (first === undefined || day.dayOf(first) >= today) continue;
			}
			if (card === undefined) {
				if (options.skip?.has(`${kind}:${entry.id}`)) continue;
				target.push({
					cardId: virtualLevelId(kind, entry.id),
					entryId: entry.id,
					virtual: true,
					kind
				});
				continue;
			}
			const schedule = scheduleFor(card.id, reviews, now, w, options.ctx.clock);
			if (schedule === null) {
				target.push({ cardId: card.id, entryId: entry.id, virtual: false, kind });
				continue;
			}
			if (!isDueNow(schedule, now, options.ctx)) continue;
			due.push({
				item: { cardId: card.id, entryId: entry.id, virtual: false, kind },
				at: instant(schedule.due)
			});
		}
	}

	due.sort((a, b) => a.at - b.at);
	return {
		due: due.map((entry) => entry.item),
		fresher: [...ordered(options, freshWriting), ...ordered(options, freshVocab)]
	};
}

/** What the setup page shows for one level and kind selection. */
export interface LevelPlanCounts {
	due: number;
	fresh: number;
	/** due + fresh, before the session's caps. */
	items: number;
	unitLabel: 'words' | 'characters';
}

/**
 * levelPlanCounts counts what a level session would hold before the new and
 * review caps (the daily limits apply, or none with Study all): one plan with
 * no cap, split into due and new items.
 */
export function levelPlanCounts(
	options: Omit<BuildLevelQueueOptions, 'newLimit' | 'reviewLimit'>
): LevelPlanCounts {
	const full = { ...options, newLimit: NO_LIMIT, reviewLimit: NO_LIMIT };
	const candidates = levelCandidates(full);
	const due = new Set(candidates.due.map((item) => item.cardId));
	const queue = admitPlan(full, candidates).queue;
	const dueCount = queue.filter((item) => due.has(item.cardId)).length;
	return {
		due: dueCount,
		fresh: queue.length - dueCount,
		items: queue.length,
		unitLabel: (options.unit ?? 'word') === 'character' ? 'characters' : 'words'
	};
}

/** Whether a unit studies at least one of the selected kinds. */
export function levelUsable(unit: LevelUnit, kinds: readonly StudyCardKind[]): boolean {
	return unit === 'character'
		? kinds.some((kind) => CHARACTER_KINDS.includes(kind))
		: kinds.includes('vocab');
}

/** Warnings for selected kinds a level session of this unit does not study. */
export function levelTypeWarnings(unit: LevelUnit, kinds: readonly StudyCardKind[]): string[] {
	if (unit === 'character') {
		return kinds.some((kind) => !CHARACTER_KINDS.includes(kind))
			? [t('study.level.characterTypes')]
			: [];
	}
	return kinds.some((kind) => kind !== 'vocab')
		? [t('study.level.vocabOnly')]
		: [];
}

/** How many entries of a level the unit studies (words, or characters). */
export function levelEntryCount(entries: readonly LevelEntry[], unit: LevelUnit): number {
	const kind = unit === 'character' ? 'character' : 'word';
	return entries.filter((entry) => entry.kind === kind).length;
}
