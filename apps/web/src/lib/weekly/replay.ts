// Replay timelines sampled at two instants: the words that reached mature
// and the characters that became learned during a week. One timeline per
// reviewed card per loaded history, so browsing weeks replays nothing.
// Pure. Rule and fixtures: docs/contracts/weekly/.

import type { CharRow } from '../api/types';
import { cellStates, masteryGlyphs } from '$lib/studycore/charGroups';
import { weightsKey } from '$lib/studycore/fsrsParams';
import { MASTERY_THRESHOLD, masteryFromSchedules } from '$lib/studycore/mastery';
import {
	isValidReview,
	scheduleAt,
	scheduleTimeline,
	type TimelinePoint
} from '$lib/studycore/scheduler';
import type { StudyClock } from '$lib/studycore/studyClock';
import type { ReviewEvent, StudyCard } from '$lib/studycore/types';
import { classifySchedule } from '../stats/wordStates';

export interface Timelines {
	/** The card's schedule after each valid review; [] when it has none. */
	of(cardId: string): readonly TimelinePoint[];
}

/** Counts scheduleTimeline calls made here; the tests read it. */
export const replayStats = { timelines: 0 };

/** Timelines kept per content key; a few, so switching workspaces does not thrash. */
const MAX_MEMO = 4;
const keys = new WeakMap<readonly ReviewEvent[], string>();

/**
 * reviewsKey identifies a review log by its content (FNV-1a over each
 * event's id, ts, card and grade, plus the count), so a study history
 * reloaded after its cache TTL — a new array with the same events — finds
 * the same timelines and log pass. Computed once per array.
 */
export function reviewsKey(reviews: readonly ReviewEvent[]): string {
	const cached = keys.get(reviews);
	if (cached !== undefined) return cached;
	let h = 0x811c9dc5;
	const mix = (text: string): void => {
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		h ^= 0x1f;
		h = Math.imul(h, 0x01000193) >>> 0;
	};
	for (const review of reviews) {
		const payload = (review?.payload ?? {}) as { cardId?: unknown; grade?: unknown };
		mix(`${review?.id}|${review?.ts}|${String(payload.cardId)}|${String(payload.grade)}`);
	}
	const key = `${reviews.length}:${h.toString(36)}`;
	keys.set(reviews, key);
	return key;
}

function build(reviews: readonly ReviewEvent[], w: readonly number[], clock: StudyClock): Timelines {
	let byCard: Map<string, ReviewEvent[]> | null = null;
	const done = new Map<string, readonly TimelinePoint[]>();
	return {
		of(cardId) {
			const cached = done.get(cardId);
			if (cached !== undefined) return cached;
			if (byCard === null) {
				byCard = new Map();
				for (const review of reviews) {
					if (!isValidReview(review)) continue;
					const list = byCard.get(review.payload.cardId);
					if (list === undefined) byCard.set(review.payload.cardId, [review]);
					else list.push(review);
				}
			}
			const history = byCard.get(cardId);
			let timeline: readonly TimelinePoint[] = [];
			if (history !== undefined) {
				replayStats.timelines += 1;
				timeline = scheduleTimeline(cardId, history, w, clock);
			}
			done.set(cardId, timeline);
			return timeline;
		}
	};
}

/**
 * timelinesFor: one lazily built timeline per reviewed card, memoised in
 * `memo` (the session's, context/caches.ts) by the reviews' content
 * (reviewsKey), the weights and the clock runs.
 */
export function timelinesFor(
	memo: Map<string, Timelines>,
	reviews: readonly ReviewEvent[],
	w: readonly number[],
	clock: StudyClock
): Timelines {
	const key = `${reviewsKey(reviews)}|${weightsKey(w)}|${JSON.stringify(clock.runs)}`;
	let t = memo.get(key);
	if (t === undefined) {
		t = build(reviews, w, clock);
		if (memo.size >= MAX_MEMO) memo.delete(memo.keys().next().value as string);
	} else {
		memo.delete(key);
	}
	memo.set(key, t);
	return t;
}

/** givenTimelines: the fixture form, schedules given directly (no FSRS). */
export function givenTimelines(
	map: Record<string, readonly { ts: string; state: number; stability: number }[]>
): Timelines {
	const out = new Map<string, TimelinePoint[]>();
	for (const [id, points] of Object.entries(map)) {
		out.set(
			id,
			points
				.map((p) => ({
					ts: Date.parse(p.ts),
					schedule: { due: p.ts, stability: p.stability, difficulty: 0, state: p.state }
				}))
				.sort((a, b) => a.ts - b.ts)
		);
	}
	return { of: (id) => out.get(id) ?? [] };
}

/**
 * wordsReachingMature: live vocab cards in an existing deck that are not
 * mature from the reviews before `before` and mature from those before
 * `after` (cutoffs in epoch ms).
 */
export function wordsReachingMature(
	cards: readonly StudyCard[],
	deckIds: ReadonlySet<string>,
	t: Timelines,
	before: number,
	after: number
): number {
	let n = 0;
	for (const card of cards) {
		if (card.kind !== 'vocab' || !card.deckIds.some((id) => deckIds.has(id))) continue;
		const timeline = t.of(card.id);
		if (timeline.length === 0) continue;
		if (classifySchedule(scheduleAt(timeline, after)) !== 'mature') continue;
		if (classifySchedule(scheduleAt(timeline, before)) === 'mature') continue;
		n += 1;
	}
	return n;
}

function learnedAt(chars: readonly CharRow[], cards: readonly StudyCard[], t: Timelines, cutoff: number): boolean[] {
	const mastery = masteryFromSchedules(masteryGlyphs(chars), cards, (id) => scheduleAt(t.of(id), cutoff));
	return cellStates(chars, mastery).map((cell) => cell.score >= MASTERY_THRESHOLD);
}

/** charactersLearned: universe cells learned at `after` and not at `before` (the map's rule). */
export function charactersLearned(
	chars: readonly CharRow[],
	cards: readonly StudyCard[],
	t: Timelines,
	before: number,
	after: number
): number {
	if (chars.length === 0) return 0;
	const was = learnedAt(chars, cards, t, before);
	const is = learnedAt(chars, cards, t, after);
	let n = 0;
	for (let i = 0; i < chars.length; i++) if (is[i] && !was[i]) n += 1;
	return n;
}
