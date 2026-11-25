// Scheduling is derived, never stored: a card's state is whatever
// replaying its review events through ts-fsrs produces. That keeps the
// server log authoritative and makes a schedule reproducible on any
// device from the same events.

import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs';

import { orderNew } from './newOrder';
import { compareById, instantOf, isValidReview, sortedReviews } from './reviewOrder';
import { weightsKey } from './fsrs/params';
import { feedInstants, type StudyClock } from './studyClock';
import { isDueNow, type StudyContext } from './studyContext';
import { dayCountsCached, type Candidate, type DayCounts } from './limits';
import { admitSession } from './sessionQueue';
import type { ReviewEvent, ReviewGrade, StudyCard, StudyCardKind } from './types';

/** The derived schedule of one card. `due` is an RFC 3339 instant. */
export interface Schedule {
	due: string;
	stability: number;
	difficulty: number;
	state: number;
}

export interface BuildQueueOptions {
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	deckIds: readonly string[];
	newLimit: number;
	reviewLimit: number;
	now: Date;
	/** The study clock and vacation state of the workspace. */
	ctx: StudyContext;
	/** Card kinds to include; every kind when omitted. */
	kinds?: readonly StudyCardKind[];
	/** The workspace's active FSRS weights (`activeWeights(history)`). */
	w: readonly number[];
	/**
	 * A ready schedule lookup (the decks view builds one index for many
	 * counts). Absent: each card's history is replayed. null = never reviewed.
	 */
	scheduleOf?: (cardId: string) => Schedule | null;
	/**
	 * What today already used (limits.ts). Absent: counted from `cards` and
	 * `reviews`; the decks view passes one shared count for many queues.
	 */
	counts?: DayCounts;
	/**
	 * The new-card order (#75): a key per never-reviewed card, lower
	 * first, null after every keyed card (orderNew). Absent: the order
	 * added. Reviews and the due order are unchanged.
	 */
	newKey?: (card: StudyCard) => number | null;
}

// One scheduler instance per weight set: instances are stateless between
// calls, so equal weights share one. Every other option stays the
// ts-fsrs default (fuzz off, short-term on). A pure function's memo of
// numbers (at most 16 weight sets), no rows: it may outlive a session
// (record 0009's allow-list).
const MAX_SCHEDULERS = 16;
const schedulers = new Map<string, ReturnType<typeof fsrs>>();

function schedulerFor(w: readonly number[]): ReturnType<typeof fsrs> {
	const key = weightsKey(w);
	let instance = schedulers.get(key);
	if (instance === undefined) {
		if (schedulers.size >= MAX_SCHEDULERS) {
			const oldest = schedulers.keys().next().value;
			if (oldest !== undefined) schedulers.delete(oldest);
		}
		instance = fsrs({ w: [...w] });
		schedulers.set(key, instance);
	}
	return instance;
}

/** schedulerCacheSize is the number of memoised instances (for tests). */
export function schedulerCacheSize(): number {
	return schedulers.size;
}

// Map the Anki grades explicitly instead of relying on numeric parity:
// 1 Again, 2 Hard, 3 Good, 4 Easy.
const RATING: Record<ReviewGrade, Grade> = {
	1: Rating.Again,
	2: Rating.Hard,
	3: Rating.Good,
	4: Rating.Easy
};

// The review rules live in reviewOrder.ts (#175); re-exported so existing imports keep working.
export { isValidReview, sortedReviews };
const instant = instantOf;
const byId = compareById;

/** The schedule of a card right after one of its reviews (`ts`: the review's real instant, epoch ms). */
export interface TimelinePoint {
	ts: number;
	schedule: Schedule;
}

/** The valid reviews of a card in replay order with their real instants and the cards ts-fsrs produced. */
function replay(
	cardId: string,
	reviews: readonly ReviewEvent[],
	w: readonly number[],
	clock: StudyClock,
	onStep: (card: Card, realTs: number, fedTs: number) => void
): void {
	const scheduler = schedulerFor(w);
	const history = sortedReviews(
		reviews.filter((review) => isValidReview(review) && review.payload.cardId === cardId)
	);
	if (history.length === 0) return;
	const real = history.map((review) => instant(review.ts));
	const fed = feedInstants(real, clock);
	let card: Card = createEmptyCard(new Date(fed[0]));
	history.forEach((review, i) => {
		card = scheduler.next(card, new Date(fed[i]), RATING[review.payload.grade]).card;
		onStep(card, real[i], fed[i]);
	});
}

function toSchedule(card: Card, clock: StudyClock): Schedule {
	return {
		due: new Date(clock.inverse(card.due.getTime())).toISOString(),
		stability: card.stability,
		difficulty: card.difficulty,
		state: card.state as number
	};
}

/**
 * scheduleTimeline replays one card's valid reviews from an empty card and
 * returns the schedule after each of them, in replay order (ts, then id);
 * [] when the card has none. Its last point is scheduleFor's result, and
 * the point before any instant is the replay of the reviews before it
 * (feedInstants only looks back), so one replay answers every cutoff.
 */
export function scheduleTimeline(
	cardId: string,
	reviews: readonly ReviewEvent[],
	w: readonly number[],
	clock: StudyClock
): TimelinePoint[] {
	const out: TimelinePoint[] = [];
	replay(cardId, reviews, w, clock, (card, ts) => out.push({ ts, schedule: toSchedule(card, clock) }));
	return out;
}

/**
 * scheduleAt is the schedule replayed from the reviews with ts < cutoff:
 * the last timeline point before it; null when there is none.
 */
export function scheduleAt(timeline: readonly TimelinePoint[], cutoffMs: number): Schedule | null {
	let lo = 0;
	let hi = timeline.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (timeline[mid].ts < cutoffMs) lo = mid + 1;
		else hi = mid;
	}
	return lo === 0 ? null : timeline[lo - 1].schedule;
}

/**
 * scheduleFor replays one card's reviews from an empty card and returns
 * its derived schedule. `null` means the card has never been reviewed.
 * `now` is accepted for a stable "as of" API; the result depends only
 * on the history, so two calls with the same events agree exactly.
 * Reviews are fed to ts-fsrs on the study clock (vacation days removed)
 * and the due is mapped back (docs/contracts/scheduler/). It is the last
 * point of scheduleTimeline (one replay code path, `replay`).
 */
export function scheduleFor(
	cardId: string,
	reviews: readonly ReviewEvent[],
	now: Date,
	w: readonly number[],
	clock: StudyClock
): Schedule | null {
	void now;
	// The same replay as scheduleTimeline; only the last card becomes a Schedule.
	let last: Card | null = null;
	replay(cardId, reviews, w, clock, (card) => {
		last = card;
	});
	return last === null ? null : toSchedule(last, clock);
}

/**
 * nextIntervals previews the four grades of a card at `now` (#101): the
 * milliseconds from `now` to the due instant each grade would give. The
 * card is replayed exactly as scheduleFor does (same instance, weights and
 * study clock), `now` is fed as a review would be (`max(v(now), last fed)`)
 * and ts-fsrs `repeat` gives the outcomes, mapped back with `clock.inverse`.
 * `null` (a virtual item) or a card with no review previews an empty card,
 * the card the first review creates. Rule: docs/contracts/scheduler/.
 */
export function nextIntervals(
	cardId: string | null,
	reviews: readonly ReviewEvent[],
	now: Date,
	w: readonly number[],
	clock: StudyClock
): Record<ReviewGrade, number> {
	let last: Card | null = null;
	let lastFed = -Infinity;
	if (cardId !== null) {
		replay(cardId, reviews, w, clock, (card, _real, fed) => {
			last = card;
			lastFed = fed;
		});
	}
	const fedNow = Math.max(clock.v(now.getTime()), lastFed);
	const card: Card = last ?? createEmptyCard(new Date(fedNow));
	const outcomes = schedulerFor(w).repeat(card, new Date(fedNow));
	const after = (grade: ReviewGrade): number =>
		clock.inverse(outcomes[RATING[grade]].card.due.getTime()) - now.getTime();
	return { 1: after(1), 2: after(2), 3: after(3), 4: after(4) };
}

/** isDue reports whether a schedule has reached its due instant. */
export function isDue(schedule: Schedule, now: Date): boolean {
	return instant(schedule.due) <= now.getTime();
}

/**
 * buildQueue assembles one session: reviewed cards that are due first,
 * earliest due first, then never-reviewed cards. Reviewed cards that
 * are not due yet are neither reviews nor new, so they are omitted.
 * Only cards belonging to one of `deckIds` are considered.
 */
export function buildQueue(options: BuildQueueOptions): StudyCard[] {
	const { newLimit, reviewLimit, ctx } = options;
	const { candidates, byId: cardById, counts } = queueCandidates(options);
	const { inSession } = admitSession({ candidates, ctx, counts, caps: { newLimit, reviewLimit } });
	return candidates.filter((c) => inSession.has(c.cardId)).map((c) => cardById.get(c.cardId) as StudyCard);
}

/**
 * queueCandidates lists what a queue could hold before any limit: the due
 * cards (earliest due first), then the never-reviewed ones, each with its
 * decks and bucket for admit(). Empty on a vacation day.
 */
export function queueCandidates({
	cards,
	reviews,
	deckIds,
	now,
	ctx,
	kinds,
	w,
	scheduleOf,
	counts,
	newKey
}: BuildQueueOptions): { candidates: Candidate[]; byId: Map<string, StudyCard>; counts: DayCounts } {
	const dayUsed = counts ?? dayCountsCached(cards, reviews, ctx, now);
	if (ctx.vacationToday) return { candidates: [], byId: new Map(), counts: dayUsed };
	const wanted = new Set(deckIds);
	const scoped = cards.filter(
		(card) =>
			card.deckIds.some((id) => wanted.has(id)) && (kinds === undefined || kinds.includes(card.kind))
	);

	const historyByCard = new Map<string, ReviewEvent[]>();
	for (const review of reviews) {
		if (!isValidReview(review)) continue;
		const history = historyByCard.get(review.payload.cardId);
		if (history === undefined) {
			historyByCard.set(review.payload.cardId, [review]);
		} else {
			history.push(review);
		}
	}

	const due: { card: StudyCard; at: number }[] = [];
	const fresh: StudyCard[] = [];

	for (const card of scoped) {
		const history = historyByCard.get(card.id);
		if (scheduleOf === undefined && history === undefined) {
			fresh.push(card);
			continue;
		}
		const schedule =
			scheduleOf === undefined ? scheduleFor(card.id, history ?? [], now, w, ctx.clock) : scheduleOf(card.id);
		if (scheduleOf !== undefined && schedule === null) {
			fresh.push(card);
			continue;
		}
		if (schedule !== null && isDueNow(schedule, now, ctx)) {
			due.push({ card, at: instant(schedule.due) });
		}
	}

	due.sort((a, b) => a.at - b.at || byId(a.card, b.card));
	fresh.sort((a, b) => instant(a.createdAt) - instant(b.createdAt) || byId(a, b));
	const ordered = newKey === undefined ? fresh : orderNew(fresh, newKey);

	const candidates: Candidate[] = [
		...due.map(({ card }) => ({
			cardId: card.id,
			deckIds: card.deckIds,
			bucket: dayUsed.reviewedToday.has(card.id) ? ('continuing' as const) : ('review' as const)
		})),
		...ordered.map((card) => ({ cardId: card.id, deckIds: card.deckIds, bucket: 'new' as const }))
	];
	const map = new Map([...due.map((e) => e.card), ...ordered].map((card) => [card.id, card]));
	return { candidates, byId: map, counts: dayUsed };
}

// Moved to limits.ts (#175); re-exported so existing imports keep working.
export { existingDecksOf, limitsOf } from './limits';

// XP lives in exp.ts; re-exported so existing imports keep working.
export { levelFromXp, xpFromReviews } from './exp';
