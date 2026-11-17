// The numbers of the decks page: words, cards, states, studied, mastered,
// due/new and the two review statistics (30-day reviews, retention). Every
// figure reuses an existing definition (wordStates.ts, mastery.ts,
// dueCounts.ts); the rule and fixtures live in docs/contracts/decks/.
//
// One schedule replay per reviewed card (`scheduleIndex`) serves every
// deck on the page, the due counts included.

import { t } from '$lib/i18n';
import { GENERAL_DECK_ID } from '$lib/study/store';
import { cardScore, MASTERY_THRESHOLD } from '$lib/study/mastery';
import { dueCounts } from '$lib/study/dueCounts';
import { isValidReview, scheduleFor, type Schedule } from '$lib/study/scheduler';
import type { DeckSettings } from '$lib/study/deckSettings';
import type { Deck, ReviewEvent, StudyCard, StudyCardKind } from '$lib/study/types';
import { classifySchedule, emptyCounts, type WordStateCounts } from '$lib/stats/wordStates';
import type { StudyContext } from '$lib/study/studyContext';
import type { StudyClock } from '$lib/study/studyClock';

/** Reviewed card ids only; a missing id means "never reviewed". */
export type ScheduleIndex = Map<string, Schedule | null>;

/** Fewer eligible reviews than this show no retention figure. */
export const RETENTION_MIN_REVIEWS = 10;

/** The window of the review statistics, in learner days ending today. */
export const STATS_WINDOW_DAYS = 30;

const HOUR_MS = 3_600_000;
// A learner's day is at most 25 hours long; burying only reads today's reviews.
const RECENT_MS = 48 * HOUR_MS;

type ScheduleFn = typeof scheduleFor;

export interface DeckNumbers {
	words: number;
	cards: number;
	due: number;
	fresh: number;
	states: WordStateCounts;
	studied: number;
	mastered: number;
	reviews30: number;
	/** Share (0-1) of eligible reviews in the window graded Hard or better; null below the floor. */
	retention: number | null;
	/** How many reviews retention is computed from. */
	retentionBase: number;
}

export interface DeckNumbersInput {
	/** null = overall (every card in at least one existing deck). */
	deckId: string | null;
	cards: readonly StudyCard[];
	decks: readonly Deck[];
	reviews: readonly ReviewEvent[];
	index: ScheduleIndex;
	/** The kinds a session over this scope studies (effectiveKinds). */
	kinds: readonly StudyCardKind[];
	deckSettings?: Record<string, DeckSettings>;
	now: Date;
	w: readonly number[];
	/** The learner's day, study clock and vacation state (one object, see decksData). */
	ctx: StudyContext;
	addDays: (day: string, n: number) => string;
}

/**
 * scheduleIndex replays every reviewed card once. `schedule` is injectable
 * so a test can count the replays.
 */
export function scheduleIndex(
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	w: readonly number[],
	clock: StudyClock,
	schedule: ScheduleFn = scheduleFor
): ScheduleIndex {
	const byCard = new Map<string, ReviewEvent[]>();
	for (const review of reviews) {
		if (!isValidReview(review)) continue;
		const list = byCard.get(review.payload.cardId);
		if (list === undefined) byCard.set(review.payload.cardId, [review]);
		else list.push(review);
	}
	const index: ScheduleIndex = new Map();
	// The replay depends only on the history; `now` is a stable placeholder.
	const asOf = new Date(0);
	for (const card of cards) {
		const history = byCard.get(card.id);
		if (history === undefined) continue;
		const result = schedule(card.id, history, asOf, w, clock);
		if (result !== null) index.set(card.id, result);
	}
	return index;
}

interface Fact {
	cardId: string;
	ms: number;
	grade: number;
	/** The card's first review ever: it has no earlier one to be remembered from. */
	first: boolean;
}

// The review log is read once per array: parsed, ordered, first reviews marked.
// A changed length drops the entry, so appending to the same array stays correct.
const factsCache = new WeakMap<readonly ReviewEvent[], { length: number; facts: Fact[] }>();

function factsOf(reviews: readonly ReviewEvent[]): Fact[] {
	const cached = factsCache.get(reviews);
	if (cached !== undefined && cached.length === reviews.length) return cached.facts;
	const rows = reviews
		.filter(isValidReview)
		.map((r) => ({ id: r.id, cardId: r.payload.cardId, ms: Date.parse(r.ts), grade: r.payload.grade as number }))
		.sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const seen = new Set<string>();
	const facts = rows.map(({ cardId, ms, grade }) => {
		const first = !seen.has(cardId);
		seen.add(cardId);
		return { cardId, ms, grade, first };
	});
	factsCache.set(reviews, { length: reviews.length, facts });
	return facts;
}

const recentCache = new WeakMap<readonly ReviewEvent[], { now: number; length: number; recent: ReviewEvent[] }>();

/** The reviews that can bury anything now (today's), shared by every deck's due count. */
function recentReviews(reviews: readonly ReviewEvent[], now: number): ReviewEvent[] {
	const cached = recentCache.get(reviews);
	if (cached !== undefined && cached.now === now && cached.length === reviews.length) return cached.recent;
	const recent = reviews.filter((r) => isValidReview(r) && Date.parse(r.ts) >= now - RECENT_MS);
	recentCache.set(reviews, { now, length: reviews.length, recent });
	return recent;
}

/** deckNumbers: the numbers of one deck, or of everything for `deckId: null`. */
export function deckNumbers(input: DeckNumbersInput): DeckNumbers {
	const { deckId, cards, decks, reviews, index, kinds, deckSettings, now, w, ctx, addDays } = input;
	const day = ctx.day;
	const existing = new Set([GENERAL_DECK_ID, ...decks.map((d) => d.id)]);
	const scopeDecks = deckId === null ? [...existing] : [deckId];
	const wanted = new Set(scopeDecks);
	const scope = cards.filter((card) => card.deckIds.some((id) => wanted.has(id)));
	const scopeIds = new Set(scope.map((card) => card.id));

	const states = emptyCounts();
	let mastered = 0;
	for (const card of scope) {
		if (card.kind !== 'vocab') continue;
		const schedule = index.get(card.id) ?? null;
		const state = classifySchedule(schedule);
		states[state] += 1;
		states.total += 1;
		if (schedule !== null && cardScore(schedule.stability) >= MASTERY_THRESHOLD) mastered += 1;
	}

	const { due, fresh } = dueCounts({
		cards,
		reviews: recentReviews(reviews, now.getTime()),
		deckIds: scopeDecks,
		kinds,
		deckSettings,
		now,
		w,
		ctx,
		scheduleOf: (id) => index.get(id) ?? null
	});

	const today = day.today(now.getTime());
	const from = addDays(today, -(STATS_WINDOW_DAYS - 1));
	let reviews30 = 0;
	let eligible = 0;
	let kept = 0;
	// Cheap cut before the zone lookup: nothing older than 33 days is in the window.
	const cutoff = now.getTime() - 33 * 24 * HOUR_MS;
	for (const fact of factsOf(reviews)) {
		if (fact.ms < cutoff || !scopeIds.has(fact.cardId)) continue;
		const d = day.dayOf(fact.ms);
		if (d < from || d > today) continue;
		reviews30 += 1;
		if (fact.first) continue;
		eligible += 1;
		if (fact.grade >= 2) kept += 1;
	}

	return {
		words: states.total,
		cards: scope.length,
		due,
		fresh,
		states,
		studied: states.total - states.new,
		mastered,
		reviews30,
		retention: eligible >= RETENTION_MIN_REVIEWS ? kept / eligible : null,
		retentionBase: eligible
	};
}

/** The bar's parts in percent of the words: mastered, studied but not mastered, the rest. */
export function progressShares(n: Pick<DeckNumbers, 'words' | 'studied' | 'mastered'>): {
	mastered: number;
	studied: number;
	rest: number;
} {
	if (n.words === 0) return { mastered: 0, studied: 0, rest: 0 };
	const mastered = Math.min(n.mastered, n.words);
	const studied = Math.max(0, Math.min(n.studied, n.words) - mastered);
	return {
		mastered: (100 * mastered) / n.words,
		studied: (100 * studied) / n.words,
		rest: (100 * (n.words - mastered - studied)) / n.words
	};
}

/** The bar's text alternative, e.g. "40 words: 12 mastered, 18 studied". */
export function progressSummary(n: Pick<DeckNumbers, 'words' | 'studied' | 'mastered'>): string {
	return t('flashcards.deck.progress', {
		words: t('flashcards.deck.words', { count: n.words }),
		mastered: n.mastered,
		studied: n.studied
	});
}
