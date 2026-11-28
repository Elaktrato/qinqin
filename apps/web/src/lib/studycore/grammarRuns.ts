// Grammar lesson runs (#277, docs/contracts/grammar/runs.json): a finished run of
// a grammar lesson is a `grammar` study event {point, mode, score, total}, with
// `point` = `<packId>:<lessonId>` naming the grammar point. Progress (best score,
// last run) is replayed from these events, never stored. The core reads them
// for EXP and the streak; the grammar feature for its pages; grammar review and
// courses key on the point; grammar review (#181, grammarReview.ts) writes
// runs of the mode `review` and schedules each learned point from its runs.

import type { StudyEvent } from '$lib/events';

/** The most exercises a run can have. */
export const GRAMMAR_MAX_EXERCISES = 1000;

/** The event type of a grammar run. */
export const GRAMMAR_EVENT = 'grammar';

/** A finished lesson run. */
export const LESSON_MODE = 'lesson';

/** A review run of a learned point (#181, grammarReview.ts). */
export const REVIEW_MODE = 'review';

/** The modes a client reads; another mode is no run. */
export type GrammarRunMode = typeof LESSON_MODE | typeof REVIEW_MODE;

const PACK_ID = /^[A-Za-z0-9._-]{1,128}$/;
const LESSON_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One readable lesson run. */
export interface GrammarRun {
	id: string;
	workspaceId: number;
	ts: string;
	/** The instant of `ts`, epoch milliseconds. */
	at: number;
	point: string;
	packId: string;
	lessonId: string;
	mode: GrammarRunMode;
	score: number;
	total: number;
}

/** A grammar point's progress, replayed from its runs. */
export interface GrammarProgress {
	best: number;
	total: number;
	/** The `ts` of the last run. */
	completedAt: string;
	runs: number;
}

/** grammarPoint names the grammar point of a lesson. */
export function grammarPoint(packId: string, lessonId: string): string {
	return `${packId}:${lessonId}`;
}

/** splitPoint reads a point back into its pack and lesson; null when it is not one. */
export function splitPoint(point: string): { packId: string; lessonId: string } | null {
	const at = point.indexOf(':');
	if (at < 0) return null;
	const packId = point.slice(0, at);
	const lessonId = point.slice(at + 1);
	if (!PACK_ID.test(packId) || lessonId.length > 128 || !LESSON_ID.test(lessonId)) return null;
	return { packId, lessonId };
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= GRAMMAR_MAX_EXERCISES;
}

/** parseGrammarRun reads a stored event as a run (a lesson or a review); null when it is not a readable one (an unknown mode included). */
export function parseGrammarRun(event: Pick<StudyEvent, 'id' | 'workspaceId' | 'ts' | 'type' | 'payload'>): GrammarRun | null {
	if (event === null || typeof event !== 'object' || event.type !== GRAMMAR_EVENT) return null;
	const p = event.payload;
	if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
	const { point, mode, score, total } = p as Record<string, unknown>;
	if ((mode !== LESSON_MODE && mode !== REVIEW_MODE) || typeof point !== 'string') return null;
	const ids = splitPoint(point);
	if (ids === null || !isCount(score) || !isCount(total) || score > total) return null;
	if (typeof event.ts !== 'string') return null;
	const at = Date.parse(event.ts);
	if (!Number.isFinite(at)) return null;
	return { id: String(event.id), workspaceId: event.workspaceId, ts: event.ts, at, point, ...ids, mode, score, total };
}

/** grammarRunsOf keeps the workspace's readable runs of a log, in replay order (instant, then id). */
export function grammarRunsOf(workspaceId: number, events: readonly StudyEvent[]): GrammarRun[] {
	const runs: GrammarRun[] = [];
	for (const event of events) {
		if (event?.workspaceId !== workspaceId) continue;
		const run = parseGrammarRun(event);
		if (run !== null) runs.push(run);
	}
	return runs.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * applyRun is one run on a point's progress: the best score is kept unless the
 * lesson now has another number of exercises (a re-import, a script
 * conversion), whose scores are not comparable: then it starts over.
 */
export function applyRun(prev: GrammarProgress | undefined, run: Pick<GrammarRun, 'ts' | 'score' | 'total'>): GrammarProgress {
	const best = prev !== undefined && prev.total === run.total ? Math.max(prev.best, run.score) : run.score;
	return { best, total: run.total, completedAt: run.ts, runs: (prev?.runs ?? 0) + 1 };
}

/**
 * grammarProgress replays the lesson runs (in replay order, as grammarRunsOf gives them) into each point's
 * progress. A review run (#181) has its own number of exercises and is left out: the review state is its own
 * derivation (grammarReview.ts).
 */
export function grammarProgress(runs: readonly GrammarRun[]): Map<string, GrammarProgress> {
	const out = new Map<string, GrammarProgress>();
	for (const run of runs) if (run.mode === LESSON_MODE) out.set(run.point, applyRun(out.get(run.point), run));
	return out;
}
