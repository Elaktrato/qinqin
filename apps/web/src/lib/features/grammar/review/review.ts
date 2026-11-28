// Grammar review on the web (#181, docs/contracts/grammar/review.json): what the Grammar page and a review round
// read (each learned point's state, the round over the installed lessons), the exercises of one review, and the
// review run, recorded as a `grammar` event of mode `review` through the session's outbox. The rules live in the
// study core (lib/studycore/grammarReview.ts).

import type { StudyEventBody, Workspace } from '$lib/api/types';
import type { Session } from '$lib/context/session.svelte';
import { grammarPayload } from '$lib/events/eventPayloads';
import { newUlid } from '$lib/events/ulid';
import { shuffleTokens } from '$lib/exercises/wordSalad';
import { contextForData } from '$lib/studycore/currentContext';
import { loadStudyHistory } from '$lib/studycore/data';
import {
	REVIEW_MODE,
	grammarPointStates,
	grammarReviewRound,
	isPointDue,
	reviewPick,
	type GrammarPointState,
	type GrammarRound
} from '$lib/studycore/grammarReview';
import { GRAMMAR_EVENT, grammarPoint, grammarProgress, parseGrammarRun, type GrammarProgress, type GrammarRun } from '$lib/studycore/grammarRuns';
import { listGrammar } from '../api';
import { hasCloze, type Exercise } from '../exercises';
import type { Lesson, PackInfo } from '../types';

/** candidatePoints: the points of the installed lessons, in pack and lesson order. */
export function candidatePoints(packs: readonly PackInfo[]): string[] {
	return packs.flatMap((p) => (p.lessons ?? []).map((l) => grammarPoint(p.packId, l.id)));
}

/** What the Grammar page and a round read. */
export interface ReviewData {
	packs: PackInfo[];
	/** Each lesson's progress (lesson runs only). */
	progress: Map<string, GrammarProgress>;
	/** Each learned point's review state. */
	states: Map<string, GrammarPointState>;
	round: GrammarRound;
	/** Each installed point's lesson title. */
	titles: Map<string, string>;
}

/**
 * loadReview reads the workspace's history (queued runs included) and the installed grammar packs of its language,
 * and derives the states and the round at `now`.
 */
export async function loadReview(
	session: Pick<Session, 'study' | 'zone'>,
	workspace: Pick<Workspace, 'id' | 'language'>,
	now: number = Date.now(),
	opts: { force?: boolean } = {}
): Promise<ReviewData> {
	const [history, packs] = await Promise.all([loadStudyHistory(session.study, workspace.id, opts), listGrammar(workspace.language)]);
	const ctx = contextForData(session.zone, history, workspace.id, now);
	const states = grammarPointStates(history.grammarRuns, ctx.clock);
	const titles = new Map<string, string>();
	for (const p of packs) for (const l of p.lessons ?? []) titles.set(grammarPoint(p.packId, l.id), l.title);
	return {
		packs,
		progress: grammarProgress(history.grammarRuns),
		states,
		round: grammarReviewRound(candidatePoints(packs), states, now, ctx.day),
		titles
	};
}

/** The exercises of a point's review number `reviews`: the picked examples, a cloze's choices shuffled per review. */
export function reviewExercises(lesson: Lesson, reviews: number): Exercise[] {
	const byId = new Map(lesson.examples.map((e) => [e.id, e]));
	const picks = reviewPick(
		lesson.examples.map((e) => ({ id: e.id, cloze: hasCloze(e), order: !e.noOrder })),
		reviews
	);
	return picks.map(({ example: id, kind }) => {
		const example = byId.get(id)!;
		return kind === 'cloze'
			? { kind, example, choices: shuffleTokens([example.focus, ...example.distractors], `${lesson.id}:${reviews}:${id}`) }
			: { kind, example };
	});
}

/** A learned point as its lesson row shows it. */
export interface PointStatus {
	due: boolean;
	dueAt: string;
	lastReviewed: string | null;
	learnedAt: string;
}

/** pointStatus: null for a point that is not learned. */
export function pointStatus(state: GrammarPointState | undefined, now: number): PointStatus | null {
	if (state === undefined) return null;
	return { due: isPointDue(state, now), dueAt: state.due, lastReviewed: state.lastReviewed, learnedAt: state.learnedAt };
}

/** reviewEvent builds the event of one review run. */
export function reviewEvent(workspaceId: number, packId: string, lessonId: string, score: number, total: number, now: number = Date.now()): StudyEventBody {
	return {
		id: newUlid(now),
		workspaceId,
		device: 'web',
		ts: new Date(now).toISOString(),
		type: GRAMMAR_EVENT,
		payload: grammarPayload(packId, lessonId, score, total, REVIEW_MODE)
	};
}

/**
 * recordReview records a review run (write-ahead in the outbox: a run that cannot be sent now is sent later).
 * Answers the run (EXP and the streak of a session count it); throws when it was not kept: its workspace was deleted.
 */
export async function recordReview(
	session: { outbox: Pick<Session['outbox'], 'recordEvent'> },
	workspaceId: number,
	packId: string,
	lessonId: string,
	score: number,
	total: number,
	now: number = Date.now()
): Promise<GrammarRun> {
	const event = reviewEvent(workspaceId, packId, lessonId, score, total, now);
	const kept = await session.outbox.recordEvent(event);
	if (kept === null) throw new Error('grammar: the review was not saved, its workspace is gone');
	return parseGrammarRun(event)!;
}
