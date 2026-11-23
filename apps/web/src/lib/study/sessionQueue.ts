// The session queue builder (#175): the part every session plan shares.
// Deck sessions, level sessions and the counts list their candidates in
// queue order each in their own way (cardFlow.ts, levelQueue.ts,
// scheduler.ts); this module admits them through the session caps and the
// daily limits and splits queue and reserve. Pure: every input is passed
// in. Rule and fixture: docs/contracts/cards/ (session-queue.json).

import {
	admit,
	cap,
	existingDecksOf,
	limitsOf,
	NO_LIMIT,
	type Admission,
	type Candidate,
	type DayCounts,
	type LimitPair
} from './limits';
import type { StudyContext } from './studyContext';
import type { StudyCard, StudyCardKind } from './types';

/** What the builder reads of a study context: the limit rows and the vacation flag. */
export type QueueContext = Pick<StudyContext, 'limits' | 'vacationToday'>;

/** The session caps of the setup (new cards, reviews). */
export interface SessionCaps {
	newLimit: number;
	reviewLimit: number;
}

export interface AdmitSessionInput {
	/** In queue order. */
	candidates: readonly Candidate[];
	ctx: QueueContext;
	/** What today already used (limits.ts dayCounts). */
	counts: DayCounts;
	caps: SessionCaps;
	/** Study all: no session caps and no daily limits for this one session. */
	studyAll?: boolean;
}

export interface SessionAdmission {
	/** The candidates the session holds. */
	inSession: Set<string>;
	/** The same without the session's new-card cap: the session plus its reserve. */
	inAllowance: Set<string>;
	/** What the daily limits admit with no session cap at all (admit().left). */
	left: Admission['left'];
}

const UNLIMITED_PAIR: LimitPair = { new: null, reviews: null };

/**
 * admitSession is the one admission of every session: nothing on a vacation
 * day; otherwise admit() of scheduler/daily-limits with the floored session
 * caps and each deck's daily limits, or, for Study all, NO_LIMIT caps and no
 * daily limit at all (not even the defaults).
 */
export function admitSession({ candidates, ctx, counts, caps, studyAll = false }: AdmitSessionInput): SessionAdmission {
	if (ctx.vacationToday) {
		return {
			inSession: new Set(),
			inAllowance: new Set(),
			left: { reviews: 0, new: 0, unlimited: false, limitedOut: 0 }
		};
	}
	const session = studyAll
		? { newLimit: NO_LIMIT, reviewLimit: NO_LIMIT }
		: { newLimit: cap(caps.newLimit), reviewLimit: cap(caps.reviewLimit) };
	const limitsFor = studyAll ? () => UNLIMITED_PAIR : (deckId: string) => limitsOf(ctx, deckId);
	const existing = existingDecksOf(ctx, candidates);
	const main = admit(candidates, limitsFor, counts, session, existing);
	const allowance = admit(candidates, limitsFor, counts, { ...session, newLimit: Infinity }, existing);
	return { inSession: new Set(main.admitted), inAllowance: new Set(allowance.admitted), left: main.left };
}

/**
 * How many dropped virtual items one session replaces from the reserve. A
 * deck of mostly unsuitable words would otherwise fetch every entry one by
 * one before the session could end.
 */
export function backfillLimit(newLimit: number): number {
	return Math.max(30, 2 * cap(newLimit));
}

/** sessionBackfill: the session's replacement bound, NO_LIMIT for Study all. */
export function sessionBackfill(newLimit: number, studyAll: boolean): number {
	return studyAll ? NO_LIMIT : backfillLimit(newLimit);
}

/** One candidate with the item a planner puts in the queue for it. */
export interface QueueEntry<T> extends Candidate {
	item: T;
}

export interface SessionQueue<T> {
	queue: T[];
	/** New items the daily limits allow past the session cap, in queue order. */
	reserve: T[];
	/** Replacements from the reserve left this session. */
	backfillLeft: number;
}

/**
 * buildSessionQueue: the queue is the admitted entries in candidate order;
 * the reserve the entries the allowance admits and the session does not
 * (always new items), at most backfillLeft (all a session can ever draw).
 */
export function buildSessionQueue<T>({
	entries,
	...rest
}: Omit<AdmitSessionInput, 'candidates'> & {
	entries: readonly QueueEntry<T>[];
}): SessionQueue<T> {
	const { inSession, inAllowance } = admitSession({ ...rest, candidates: entries });
	const backfillLeft = sessionBackfill(rest.caps.newLimit, rest.studyAll === true);
	return {
		queue: entries.filter((entry) => inSession.has(entry.cardId)).map((entry) => entry.item),
		reserve: entries
			.filter((entry) => inAllowance.has(entry.cardId) && !inSession.has(entry.cardId))
			.slice(0, backfillLeft)
			.map((entry) => entry.item),
		backfillLeft
	};
}

/** Non-vocab kinds each word's vocab rows say to skip (removed by the learner). */
export function skipKindsByEntry(cards: readonly StudyCard[]): Map<number, Set<StudyCardKind>> {
	const out = new Map<number, Set<StudyCardKind>>();
	for (const card of cards) {
		if (card.kind !== 'vocab' || card.skipKinds === undefined) continue;
		const set = out.get(card.entryId) ?? new Set<StudyCardKind>();
		for (const kind of card.skipKinds) set.add(kind);
		out.set(card.entryId, set);
	}
	return out;
}
