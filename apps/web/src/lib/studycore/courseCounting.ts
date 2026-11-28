// What course work counts for (#225, docs/contracts/courses/counting.json): a course **step** is a finished lesson
// that is not a grammar lesson (a course grammar lesson records a `grammar` run, which counts on its own), a unit
// test or a section exam. A step earns COURSE_STEP_XP, keeps the streak and days active, and is one activity point
// per learner day (the server's `course` rule). A started lesson and a placement are no step.

import type { StudyEvent } from '$lib/events';
import { parseCourseEvent } from './courseProgress';

/** The EXP of one course step, whatever its score (as a grammar lesson run, #277). */
export const COURSE_STEP_XP = 20;

const GRAMMAR_LESSON = 'grammar-';

/** One course step: its event, instant and identity ([kind, course, unit or section, lesson]). */
export interface CourseStep {
	id: string;
	workspaceId: number;
	/** The instant of `ts`, epoch milliseconds. */
	at: number;
	item: string[];
}

/** courseStepOf reads one stored event as a course step; null when it is none (or unreadable, #221 parse). */
export function courseStepOf(event: Pick<StudyEvent, 'id' | 'workspaceId' | 'ts' | 'type' | 'payload'>): CourseStep | null {
	const p = parseCourseEvent(event);
	if (p === null) return null;
	const step = (item: string[]): CourseStep => ({ id: p.id, workspaceId: event.workspaceId, at: p.at, item });
	switch (p.kind) {
		case 'lesson-finished':
			return p.lesson.startsWith(GRAMMAR_LESSON) ? null : step(['lesson', p.course, p.unit, p.lesson]);
		case 'unit-test':
			return step(['unit-test', p.course, p.unit]);
		case 'section-exam':
			return step(['section-exam', p.course, p.section]);
		default:
			return null;
	}
}

/** courseStepsOf: the workspace's course steps in replay order (instant, then id). */
export function courseStepsOf(workspaceId: number, events: readonly StudyEvent[]): CourseStep[] {
	const out: CourseStep[] = [];
	for (const event of events) {
		if (event?.workspaceId !== workspaceId) continue;
		const step = courseStepOf(event);
		if (step !== null) out.push(step);
	}
	return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
