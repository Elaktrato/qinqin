// A learner's progress in a course (#222, docs/contracts/courses/README.md): the workspace's `course` events,
// recorded through the session's outbox like grammar runs, replayed over the filled course by the study core's
// derivation (lib/studycore/courseProgress.ts). The known marks are by entry; the derivation takes word keys.

import type { Course, CourseWord } from '$lib/api/courses';
import type { StudyEventBody } from '$lib/api/types';
import type { Session } from '$lib/context/session.svelte';
import type { StudyEvent } from '$lib/events';
import { coursePayload, type CoursePayload } from '$lib/events/eventPayloads';
import { newUlid } from '$lib/events/ulid';
import { COURSE_EVENT, deriveCourseState, type CourseState } from '$lib/studycore/courseProgress';
import type { StudyHistory } from '$lib/studycore/types';

/** wordsByKey: every word of the course by its key (the first unit that has it). */
export function wordsByKey(course: Course): Map<string, CourseWord> {
	const out = new Map<string, CourseWord>();
	for (const section of course.sections) {
		for (const unit of section.units) {
			for (const word of unit.words) if (!out.has(word.key)) out.set(word.key, word);
		}
	}
	return out;
}

/** knownKeys: the keys of the course words whose entry the learner marked known (Ruling 11). */
export function knownKeys(course: Course, knownEntryIds: readonly number[]): string[] {
	const known = new Set(knownEntryIds);
	return [...wordsByKey(course).values()].filter((w) => known.has(w.entryId)).map((w) => w.key);
}

/** courseState: the path state of the course from a workspace's study history. */
export function courseState(course: Course, history: Pick<StudyHistory, 'courseEvents' | 'known'>): CourseState {
	return deriveCourseState(course, course.id, history.courseEvents as readonly StudyEvent[], knownKeys(course, history.known ?? []));
}

/** courseEvent builds one course event of a workspace, stamped `now`. */
export function courseEvent(workspaceId: number, payload: CoursePayload, now: number = Date.now()): StudyEventBody {
	return { id: newUlid(now), workspaceId, device: 'web', ts: new Date(now).toISOString(), type: COURSE_EVENT, payload: coursePayload(payload) };
}

/**
 * recordCourseEvent records an event write-ahead in the outbox (one that cannot be sent now is sent later). Throws
 * when it was not kept: its workspace was deleted.
 */
export async function recordCourseEvent(session: { outbox: Pick<Session['outbox'], 'recordEvent'> }, event: StudyEventBody): Promise<StudyEventBody> {
	const kept = await session.outbox.recordEvent(event);
	if (kept === null) throw new Error('courses: the event was not saved, its workspace is gone');
	return kept;
}
