// The four numbers of Stats → Overview, each a reuse of a rule defined
// elsewhere, and the reviews-per-day series of the last 30 learner days.
// Pure: the caller passes one workspace's history and the learner's day.
// Rule and fixture: docs/contracts/stats/.

import {
	deckNumbers,
	scheduleIndex,
	STATS_WINDOW_DAYS,
	type ScheduleIndex
} from '$lib/features/flashcards/decks/deckStats';
import { flashcardAmounts } from '$lib/goals/amounts';
import type { DeckSettings } from '$lib/study/deckSettings';
import { dailyStreak } from '$lib/study/exp';
import { knownEntries } from '$lib/study/known';
import { isValidReview, type Schedule } from '$lib/study/scheduler';
import { contextFor } from '$lib/study/studyContext';
import type { Deck, ReviewEvent, StudyCard, StudyCardKind } from '$lib/study/types';
import type { Run } from '$lib/study/vacation';
import { addDays, type StudyDay } from '$lib/time/studyDay';

export { STATS_WINDOW_DAYS };

export interface SummaryInput {
	workspaceId: number;
	now: number;
	/** The learner's day rule of this workspace. */
	day: StudyDay;
	cards: readonly StudyCard[];
	decks: readonly Deck[];
	/** The local review log (any workspaces; only `workspaceId` counts). */
	reviews: readonly ReviewEvent[];
	/** The live manual `known:<entryId>` marks. */
	known?: readonly number[];
	/** The merged vacation runs of this workspace. */
	vacation?: readonly Run[];
	/** The workspace's active FSRS weights. */
	w: readonly number[];
	/** The kinds a session studies (only `deckNumbers`' due counts read them). */
	kinds: readonly StudyCardKind[];
	deckSettings?: Record<string, DeckSettings>;
	/** Inject a derived schedule (fixtures); absent = replay the review log. */
	schedule?: (cardId: string) => Schedule | null;
}

export interface SummaryNumbers {
	/** Consecutive learner days with a review (`dailyStreak.current`). */
	streak: number;
	/** Entries known by the one known predicate (known.ts). */
	wordsKnown: number;
	/** The decks page's overall 30-day figure; share null below the floor. */
	recall: { share: number | null; base: number };
	/** Flashcard study seconds over the learner days of the calendar month through today. */
	studiedSeconds: number;
}

export interface ReviewDay {
	/** A learner day, YYYY-MM-DD. */
	day: string;
	count: number;
	today: boolean;
}

function ownReviews(reviews: readonly ReviewEvent[], workspaceId: number): ReviewEvent[] {
	return reviews.filter((review) => review.workspaceId === workspaceId);
}

/** schedulesOf builds one lookup for every live card: the fixture's, or one replay of the log. */
function schedulesOf(input: SummaryInput, reviews: readonly ReviewEvent[], ctx: ReturnType<typeof contextFor>): ScheduleIndex {
	if (input.schedule !== undefined) {
		return new Map(input.cards.map((card) => [card.id, input.schedule!(card.id)]));
	}
	const replayed = scheduleIndex(input.cards, reviews, input.w, ctx.clock);
	return new Map(input.cards.map((card) => [card.id, replayed.get(card.id) ?? null]));
}

function monthSeconds(input: SummaryInput, reviews: readonly ReviewEvent[], today: string): number {
	const flash = flashcardAmounts(reviews, input.day.dayOf);
	const monthStart = `${today.slice(0, 7)}-01`;
	let total = 0;
	for (let date = monthStart; date <= today; date = addDays(date, 1)) {
		total += flash.get(date)?.studySeconds ?? 0;
	}
	return total;
}

/**
 * summaryNumbers computes the four numbers. It reuses `dailyStreak`, the
 * known-word predicate (`knownEntries`), the decks page's overall figure
 * (`deckNumbers({deckId: null})`: `retention` / `retentionBase`) and the
 * goal amounts' `studySeconds`; no rule is copied.
 */
export function summaryNumbers(input: SummaryInput): SummaryNumbers {
	const reviews = ownReviews(input.reviews, input.workspaceId);
	const vacation = input.vacation ?? [];
	const ctx = contextFor(input.day, vacation, input.now);
	const index = schedulesOf(input, reviews, ctx);
	const today = input.day.today(input.now);

	const known = knownEntries(
		input.cards,
		(cardId) => index.get(cardId) ?? null,
		input.known ?? []
	);

	const recall = deckNumbers({
		deckId: null,
		cards: input.cards,
		decks: input.decks,
		reviews,
		index,
		kinds: input.kinds,
		...(input.deckSettings === undefined ? {} : { deckSettings: input.deckSettings }),
		now: new Date(input.now),
		w: input.w,
		ctx,
		addDays
	});

	return {
		streak: dailyStreak(reviews, input.now, input.day, vacation).current,
		wordsKnown: known.size,
		recall: { share: recall.retention, base: recall.retentionBase },
		studiedSeconds: monthSeconds(input, reviews, today)
	};
}

/**
 * reviewsPerDay counts the valid reviews of one workspace on each of the
 * last 30 learner days, oldest first, zero-filled. Today is flagged.
 */
export function reviewsPerDay(
	input: Pick<SummaryInput, 'workspaceId' | 'now' | 'day' | 'reviews'>
): ReviewDay[] {
	const today = input.day.today(input.now);
	const first = addDays(today, -(STATS_WINDOW_DAYS - 1));
	const counts = new Map<string, number>();
	for (const review of ownReviews(input.reviews, input.workspaceId)) {
		if (!isValidReview(review)) continue;
		const date = input.day.dayOf(Date.parse(review.ts));
		if (date < first || date > today) continue;
		counts.set(date, (counts.get(date) ?? 0) + 1);
	}
	const out: ReviewDay[] = [];
	for (let i = 0; i < STATS_WINDOW_DAYS; i++) {
		const date = addDays(first, i);
		out.push({ day: date, count: counts.get(date) ?? 0, today: date === today });
	}
	return out;
}
