// Home's "Continue course" widget (#225, docs/contracts/courses/home.json): what the workspace's course shows on Home
// — where the learner is, the next lesson one tap away, and how far along the course is. Pure.

import { NEXT_TEST, type CourseState, type DeriveCourse } from '$lib/studycore/courseProgress';
import { courseHref } from './route';

/** What the widget reads of a filled course (`Course` of lib/api/courses.ts has it all). */
export interface HomeCourse extends DeriveCourse {
	id: string;
}

export interface CourseHomeModel {
	/** start: nothing finished yet; continue: a next step; done: no unit and no catch-up lesson left. */
	status: 'start' | 'continue' | 'done';
	section: string | null;
	unit: string | null;
	/** The next lesson id (NEXT_TEST for the unit test) and the player's link. */
	next: { lesson: string; href: string } | null;
	units: { done: number; total: number };
	words: { met: number; total: number };
}

export function courseHome(course: HomeCourse, state: CourseState): CourseHomeModel {
	const units = state.sections.flatMap((s) => s.units);
	const done = units.filter((u) => u.status === 'done').length;
	const words = course.sections.reduce((n, s) => n + s.units.reduce((m, u) => m + u.words.length, 0), 0);
	const href = (unit: string, lesson: string): string =>
		lesson === NEXT_TEST ? courseHref({ view: 'test', course: course.id, unit }) : courseHref({ view: 'lesson', course: course.id, unit, lesson });
	let at: { section: string; unit: string; lesson: string } | null = state.current === null ? null : { ...state.current, lesson: state.current.next };
	if (at === null) {
		// Every unit is done: a catch-up lesson is what is left, if any (the roadmap's rule).
		for (const s of state.sections) {
			const u = s.units.find((x) => x.catchUp.length > 0);
			if (u !== undefined) {
				at = { section: s.id, unit: u.id, lesson: u.catchUp[0]!.id };
				break;
			}
		}
	}
	const started = done > 0 || units.some((u) => u.lessons.some((l) => l.status === 'done'));
	return {
		status: at === null ? 'done' : started ? 'continue' : 'start',
		section: at?.section ?? null,
		unit: at?.unit ?? null,
		next: at === null ? null : { lesson: at.lesson, href: href(at.unit, at.lesson) },
		units: { done, total: units.length },
		words: { met: state.met.length, total: words }
	};
}
