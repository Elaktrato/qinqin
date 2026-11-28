// Spaced review of grammar points (#181, docs/contracts/grammar/review.json). A grammar point is learned when its
// lesson is finished with at least 80 %; from that run on, its runs (lessons and reviews, `grammar` events,
// grammarRuns.ts) are replayed through FSRS as one card's reviews, exactly as a drill item's answers are
// (drills.ts: scheduleTimeline, the default weights, the study clock), each run graded by its score. The review
// round offers the due points and at most 5 new points a learner day. Pure; nothing is stored.

import type { StudyDay } from '$lib/time/studyDay';
import { DEFAULT_W } from './fsrsParams';
import { LESSON_MODE, type GrammarRun } from './grammarRuns';
import { scheduleTimeline, type Schedule } from './scheduler';
import type { StudyClock } from './studyClock';
import type { ReviewEvent, ReviewGrade } from './types';

export { REVIEW_MODE } from './grammarRuns';

/** A lesson run at this share of its exercises or more makes the point learned. */
export const LEARNED_PERCENT = 80;

/** The most new points (never reviewed) whose reviews a learner day may start. */
export const NEW_GRAMMAR_PER_DAY = 5;

/** The most points in a review round. */
export const GRAMMAR_ROUND_SIZE = 20;

/** The most exercises in one review of a point. */
export const REVIEW_EXERCISES = 3;

/** isLearned: a run with this score learns its point (`100 · score ≥ 80 · total`, never with no exercises). */
export function isLearned(score: number, total: number): boolean {
	return total > 0 && 100 * score >= LEARNED_PERCENT * total;
}

/** runGrade: a run's FSRS grade: learned-level Good, at least half Hard, else Again; never Easy. */
export function runGrade(score: number, total: number): ReviewGrade {
	if (isLearned(score, total)) return 3;
	return 2 * score >= total ? 2 : 1;
}

/** The derived review state of one learned point. */
export interface GrammarPointState extends Schedule {
	point: string;
	/** The `ts` of the lesson run that made it learned. */
	learnedAt: string;
	/** The runs fed after the learned one (either mode). */
	reviews: number;
	/** The `ts` of the last of them; null before the first review. */
	lastReviewed: string | null;
	/** The instant of the first of them (the day it stopped being new); null before it. */
	firstReviewAt: number | null;
}

/**
 * grammarPointStates replays each point's runs (in replay order, as grammarRunsOf gives them): nothing before its
 * first learned lesson run; from it on every run with exercises, graded by runGrade, as a card's reviews.
 */
export function grammarPointStates(runs: readonly GrammarRun[], clock: StudyClock): Map<string, GrammarPointState> {
	const fed = new Map<string, GrammarRun[]>();
	for (const run of runs) {
		const list = fed.get(run.point);
		if (list === undefined) {
			if (run.mode === LESSON_MODE && isLearned(run.score, run.total)) fed.set(run.point, [run]);
		} else if (run.total > 0) list.push(run);
	}
	const out = new Map<string, GrammarPointState>();
	for (const [point, list] of fed) {
		const reviews: ReviewEvent[] = list.map((run) => ({
			id: run.id,
			workspaceId: run.workspaceId,
			device: '',
			ts: run.ts,
			type: 'review',
			payload: { cardId: point, mode: 'vocab', grade: runGrade(run.score, run.total) }
		}));
		const timeline = scheduleTimeline(point, reviews, DEFAULT_W, clock);
		if (timeline.length === 0) continue;
		const after = list.slice(1);
		out.set(point, {
			...timeline[timeline.length - 1].schedule,
			point,
			learnedAt: list[0].ts,
			reviews: after.length,
			lastReviewed: after.length > 0 ? after[after.length - 1].ts : null,
			firstReviewAt: after.length > 0 ? after[0].at : null
		});
	}
	return out;
}

export function isPointDue(state: Pick<GrammarPointState, 'due'>, now: number): boolean {
	return Date.parse(state.due) <= now;
}

/** Why a point is in the round: a due reviewed point, or a new one under the daily cap. */
export type GrammarRoundReason = 'due' | 'new';

export interface GrammarRound {
	items: { point: string; why: GrammarRoundReason }[];
	/** Due reviewed candidates (before the round size). */
	due: number;
	/** New candidates offered today (due, under the cap left). */
	new: number;
	/** Points whose first review was on today's learner day. */
	newToday: number;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * grammarReviewRound: from the candidate points (the installed lessons, in lesson order; duplicates count once),
 * the due reviewed points, earliest due first, then the due new points, earliest learned first, at most
 * NEW_GRAMMAR_PER_DAY less the points first reviewed today; at most GRAMMAR_ROUND_SIZE.
 */
export function grammarReviewRound(
	candidates: readonly string[],
	states: ReadonlyMap<string, GrammarPointState>,
	now: number,
	day: Pick<StudyDay, 'dayOf'>
): GrammarRound {
	const today = day.dayOf(now);
	let newToday = 0;
	for (const s of states.values()) if (s.firstReviewAt !== null && day.dayOf(s.firstReviewAt) === today) newToday += 1;
	const due: { point: string; at: number }[] = [];
	const fresh: { point: string; at: number }[] = [];
	for (const point of new Set(candidates)) {
		const s = states.get(point);
		if (s === undefined || !isPointDue(s, now)) continue;
		if (s.reviews > 0) due.push({ point, at: Date.parse(s.due) });
		else fresh.push({ point, at: Date.parse(s.learnedAt) });
	}
	due.sort((a, b) => a.at - b.at || byString(a.point, b.point));
	fresh.sort((a, b) => a.at - b.at || byString(a.point, b.point));
	const offered = fresh.slice(0, Math.max(0, NEW_GRAMMAR_PER_DAY - newToday));
	const items = [
		...due.map(({ point }) => ({ point, why: 'due' as const })),
		...offered.map(({ point }) => ({ point, why: 'new' as const }))
	].slice(0, GRAMMAR_ROUND_SIZE);
	return { items, due: due.length, new: offered.length, newToday };
}

/** What a review can ask of one example: a cloze (a focus in the text, two distractors) and word order. */
export interface ReviewExample {
	id: string;
	cloze: boolean;
	order: boolean;
}

export type ReviewExerciseKind = 'cloze' | 'order';

/**
 * reviewPick: the exercises of a point's review number `reviews` (0 for the first): at most REVIEW_EXERCISES, one per
 * example, in lesson order from `(3 · reviews) mod E`, wrapping; the k-th prefers a cloze when
 * `reviews + lap + k` is even (lap = ⌊3 · reviews / E⌋), else word order, and takes the other kind when the example
 * cannot be the preferred one; an example that can be neither is skipped.
 */
export function reviewPick(examples: readonly ReviewExample[], reviews: number): { example: string; kind: ReviewExerciseKind }[] {
	const out: { example: string; kind: ReviewExerciseKind }[] = [];
	const size = examples.length;
	if (size === 0) return out;
	const n = Math.max(0, Math.floor(reviews));
	const start = (REVIEW_EXERCISES * n) % size;
	const lap = Math.floor((REVIEW_EXERCISES * n) / size);
	for (let i = 0; i < size && out.length < REVIEW_EXERCISES; i += 1) {
		const e = examples[(start + i) % size];
		const prefer: ReviewExerciseKind = (n + lap + out.length) % 2 === 0 ? 'cloze' : 'order';
		const other: ReviewExerciseKind = prefer === 'cloze' ? 'order' : 'cloze';
		if (e[prefer]) out.push({ example: e.id, kind: prefer });
		else if (e[other]) out.push({ example: e.id, kind: other });
	}
	return out;
}
