// Daily limits: how many new cards and reviews a learner day may hold, per
// workspace with per-deck overrides, counted from the review log by the
// learner's day. Pure. Rule and fixtures: docs/contracts/scheduler/.

import { onSessionEnd } from '../session/sessionEnd';
import { isValidReview, sortedReviews } from './scheduler';
import type { StudyContext } from './studyContext';
import type { ReviewEvent, StudyCard } from './types';

export const LIMITS_WORKSPACE_KEY = 'limits:workspace';
export const LIMITS_DECK_PREFIX = 'limits:deck:';

export const MAX_LIMIT = 9999;

/**
 * NO_LIMIT stands for "no limit" wherever a number is needed: Study all's
 * session caps, and counts taken before any cap. Larger than any session.
 */
export const NO_LIMIT = 1_000_000;

/** cap reads a session cap: a finite number floored, at least 0; anything else is 0. */
export function cap(limit: number): number {
	if (!Number.isFinite(limit)) return 0;
	return Math.max(0, Math.floor(limit));
}

/** `null` = unlimited. */
export interface LimitPair {
	new: number | null;
	reviews: number | null;
}

export const DEFAULT_LIMITS: LimitPair = { new: 20, reviews: 200 };

export function limitsDeckKey(deckId: string): string {
	return `${LIMITS_DECK_PREFIX}${deckId}`;
}

function isLimit(value: unknown): value is number | null {
	return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LIMIT);
}

/**
 * parseLimitRow reads a `limits:workspace` or `limits:deck:<id>` row: the
 * fields that are present and usable (a field that is not is ignored, so it
 * follows the workspace or the default). null for an unusable row.
 */
export function parseLimitRow(key: string, raw: unknown): Partial<LimitPair> | null {
	const deck = key.startsWith(LIMITS_DECK_PREFIX) && key.length > LIMITS_DECK_PREFIX.length;
	if (key !== LIMITS_WORKSPACE_KEY && !deck) return null;
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
	const row = raw as Record<string, unknown>;
	if (row.version !== 1) return null;
	const out: Partial<LimitPair> = {};
	if ('new' in row && isLimit(row.new)) out.new = row.new;
	if ('reviews' in row && isLimit(row.reviews)) out.reviews = row.reviews;
	return out;
}

/** effectiveLimits: the deck's field if present, else the workspace's, else the default. */
export function effectiveLimits(
	workspace: Partial<LimitPair> | null,
	deck: Partial<LimitPair> | null
): LimitPair {
	const base = { ...DEFAULT_LIMITS, ...(workspace ?? {}) };
	return { ...base, ...(deck ?? {}) };
}

/** The limits of one deck in a context: its row over the workspace's over the defaults. */
export function limitsOf(ctx: Pick<StudyContext, 'limits'>, deckId: string): LimitPair {
	return effectiveLimits(ctx.limits.workspace, ctx.limits.decks[deckId] ?? null);
}

/** The decks that exist: the context's list, else every deck the candidates name. */
export function existingDecksOf(
	ctx: Pick<StudyContext, 'limits'>,
	candidates: readonly { deckIds: readonly string[] }[]
): ReadonlySet<string> {
	if (ctx.limits.existingDecks !== null) return ctx.limits.existingDecks;
	return new Set(candidates.flatMap((candidate) => candidate.deckIds));
}

export interface DayCounts {
	newDone: Map<string, number>;
	reviewDone: Map<string, number>;
	/** Cards with a valid review on today. */
	reviewedToday: Set<string>;
	/** Each reviewed card's first valid review day. */
	firstDay: Map<string, string>;
}

/** dayCounts: what the learner's today already used, per deck. */
export function dayCounts(
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	ctx: StudyContext,
	now: Date
): DayCounts {
	const today = ctx.day.dayOf(now.getTime());
	const byId = new Map(cards.map((card) => [card.id, card]));
	const history = new Map<string, ReviewEvent[]>();
	for (const review of reviews) {
		if (!isValidReview(review) || !byId.has(review.payload.cardId)) continue;
		const list = history.get(review.payload.cardId);
		if (list === undefined) history.set(review.payload.cardId, [review]);
		else list.push(review);
	}
	const counts: DayCounts = {
		newDone: new Map(),
		reviewDone: new Map(),
		reviewedToday: new Set(),
		firstDay: new Map()
	};
	for (const [cardId, list] of history) {
		const days = sortedReviews(list).map((review) => ctx.day.dayOf(Date.parse(review.ts)));
		const first = days[0];
		counts.firstDay.set(cardId, first);
		const onToday = days.includes(today);
		if (onToday) counts.reviewedToday.add(cardId);
		const target = first === today ? counts.newDone : first < today && onToday ? counts.reviewDone : null;
		if (target === null) continue;
		for (const deckId of new Set(byId.get(cardId)?.deckIds ?? [])) {
			target.set(deckId, (target.get(deckId) ?? 0) + 1);
		}
	}
	return counts;
}

export interface Candidate {
	cardId: string;
	/** The decks the card is in (a virtual item: the decks it will join). */
	deckIds: readonly string[];
	/** continuing: due and already reviewed today; review: due from an earlier day; new: never reviewed. */
	bucket: 'continuing' | 'review' | 'new';
}

export interface Admission {
	admitted: string[];
	left: {
		reviews: number;
		new: number;
		/** Every involved deck is unlimited (false without candidates). */
		unlimited: boolean;
		/** Candidates a daily limit refused. */
		limitedOut: number;
	};
}

interface Pass {
	admitted: string[];
	reviews: number;
	fresh: number;
	limitedOut: number;
}

function pass(
	candidates: readonly Candidate[],
	limitsFor: (deckId: string) => LimitPair,
	counts: DayCounts,
	caps: { newLimit: number; reviewLimit: number },
	existing: ReadonlySet<string>
): Pass {
	const usedNew = new Map<string, number>();
	const usedReviews = new Map<string, number>();
	const room = (deckId: string, kind: 'new' | 'reviews'): number => {
		const limit = limitsFor(deckId)[kind];
		if (limit === null) return Infinity;
		const done = (kind === 'new' ? counts.newDone : counts.reviewDone).get(deckId) ?? 0;
		const used = (kind === 'new' ? usedNew : usedReviews).get(deckId) ?? 0;
		return Math.max(0, limit - done - used);
	};
	const out: Pass = { admitted: [], reviews: 0, fresh: 0, limitedOut: 0 };
	for (const candidate of candidates) {
		const decks = candidate.deckIds.filter((id) => existing.has(id));
		if (candidate.bucket === 'continuing') {
			if (out.reviews < caps.reviewLimit) {
				out.admitted.push(candidate.cardId);
				out.reviews++;
			}
			continue;
		}
		const kind = candidate.bucket === 'new' ? 'new' : 'reviews';
		if (!decks.every((id) => room(id, kind) > 0)) {
			out.limitedOut++;
			continue;
		}
		const capped = kind === 'new' ? out.fresh >= caps.newLimit : out.reviews >= caps.reviewLimit;
		if (capped) continue;
		const used = kind === 'new' ? usedNew : usedReviews;
		for (const id of new Set(decks)) used.set(id, (used.get(id) ?? 0) + 1);
		out.admitted.push(candidate.cardId);
		if (kind === 'new') out.fresh++;
		else out.reviews++;
	}
	return out;
}

/**
 * admit walks the candidates in queue order and keeps the ones that fit:
 * continuing cards always (up to the session review cap), reviews and new
 * cards when every existing deck of the card has allowance left and the
 * session cap is not reached; a refused card is skipped and later cards are
 * still considered. `left` is the same pass without session caps.
 */
export function admit(
	candidates: readonly Candidate[],
	limitsFor: (deckId: string) => LimitPair,
	counts: DayCounts,
	session: { newLimit: number; reviewLimit: number },
	existingDecks: ReadonlySet<string>
): Admission {
	const main = pass(candidates, limitsFor, counts, session, existingDecks);
	const free = pass(
		candidates,
		limitsFor,
		counts,
		{ newLimit: Infinity, reviewLimit: Infinity },
		existingDecks
	);
	const involved = new Set<string>();
	for (const candidate of candidates) {
		for (const id of candidate.deckIds) if (existingDecks.has(id)) involved.add(id);
	}
	const unlimited =
		involved.size > 0 &&
		[...involved].every((id) => {
			const limit = limitsFor(id);
			return limit.new === null && limit.reviews === null;
		});
	return {
		admitted: main.admitted,
		left: { reviews: free.reviews, new: free.fresh, unlimited, limitedOut: free.limitedOut }
	};
}

// Many queues of one workspace (the decks view builds one per deck) share one
// count: remembered for the last cards/reviews arrays and learner day.
let memo: { cards: readonly StudyCard[]; reviews: readonly ReviewEvent[]; today: string; counts: DayCounts } | null = null;
onSessionEnd(() => (memo = null));

/** dayCountsCached is dayCounts, reused while the same arrays and learner day are asked again. */
export function dayCountsCached(
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	ctx: StudyContext,
	now: Date
): DayCounts {
	const today = ctx.day.dayOf(now.getTime());
	if (memo !== null && memo.cards === cards && memo.reviews === reviews && memo.today === today) {
		return memo.counts;
	}
	const counts = dayCounts(cards, reviews, ctx, now);
	memo = { cards, reviews, today, counts };
	return counts;
}
