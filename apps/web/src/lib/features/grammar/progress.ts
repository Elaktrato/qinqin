// Lesson progress (#277, docs/contracts/grammar/runs.json): a finished run is a
// `grammar` study event, recorded through the session's outbox like a review;
// the progress of each lesson (best score, last run) is replayed from the
// workspace's events (lib/studycore/grammarRuns.ts), never stored.

import type { StudyEventBody } from '$lib/api/types';
import type { Session } from '$lib/context/session.svelte';
import { grammarPayload } from '$lib/events/eventPayloads';
import { newUlid } from '$lib/events/ulid';
import { loadStudyHistory } from '$lib/studycore/data';
import { GRAMMAR_EVENT, applyRun, grammarPoint, grammarProgress } from '$lib/studycore/grammarRuns';
import type { Progress } from './types';

/** progressKey: the map key of a lesson's progress (its grammar point). */
export function progressKey(packId: string, lessonId: string): string {
	return grammarPoint(packId, lessonId);
}

/**
 * loadProgress replays the workspace's grammar runs (the study history: the
 * event log, queued and just-sent events included) into each lesson's
 * progress, by progressKey.
 */
export async function loadProgress(session: Pick<Session, 'study'>, workspaceId: number, opts: { force?: boolean } = {}): Promise<Map<string, Progress>> {
	const history = await loadStudyHistory(session.study, workspaceId, opts);
	return grammarProgress(history.grammarRuns);
}

/** runEvent builds the event of one finished run. */
export function runEvent(workspaceId: number, packId: string, lessonId: string, score: number, total: number, now: number = Date.now()): StudyEventBody {
	return {
		id: newUlid(now),
		workspaceId,
		device: 'web',
		ts: new Date(now).toISOString(),
		type: GRAMMAR_EVENT,
		payload: grammarPayload(packId, lessonId, score, total)
	};
}

/**
 * recordRun records a finished run (write-ahead in the outbox: a run that
 * cannot be sent now is sent later) and answers the lesson's progress with
 * it, from `previous` (the progress before the run). Throws when the run was
 * not kept: its workspace was deleted.
 */
export async function recordRun(
	session: { outbox: Pick<Session['outbox'], 'recordEvent'> },
	workspaceId: number,
	packId: string,
	lessonId: string,
	score: number,
	total: number,
	previous: Progress | undefined,
	now: number = Date.now()
): Promise<Progress> {
	const event = runEvent(workspaceId, packId, lessonId, score, total, now);
	const kept = await session.outbox.recordEvent(event);
	if (kept === null) throw new Error('grammar: the run was not saved, its workspace is gone');
	return applyRun(previous, { ts: event.ts, score, total });
}
