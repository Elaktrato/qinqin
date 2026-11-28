// The roadmap (#222): the filled course and its derived path state as rows to show — sections and units with their
// state, each unit's lessons with a label and a link while open, the actions on a unit (the unit test, "Add these as
// cards" for a skipped unit), the section exam, and the word-count milestones along the path (Ruling 26). Pure.

import type { Course, CourseLesson, CourseTitle } from '$lib/api/courses';
import { t } from '$lib/i18n';
import { NEXT_TEST, type CourseState, type LessonStatus, type Status } from '$lib/studycore/courseProgress';
import { courseHref } from './route';
import { placementFirst } from './tests';

/** The words-met marks shown along the path (Ruling 26). */
export const MILESTONE_WORDS: readonly number[] = [50, 100, 250, 500, 1000, 1500, 2000, 3000];

export interface RoadmapLesson {
	id: string;
	kind: CourseLesson['kind'];
	label: string;
	status: LessonStatus;
	started: boolean;
	/** The player's link; null while locked. */
	href: string | null;
}

export interface RoadmapUnit {
	id: string;
	title: string;
	status: Status;
	/** The course's current unit. */
	current: boolean;
	skipped: boolean;
	testPassed: boolean;
	/** The next lesson id or 'test' while open. */
	next: string | null;
	lessons: RoadmapLesson[];
	catchUp: RoadmapLesson[];
	words: number;
	/** The unit test's link: on a unit with a test that is not passed yet, before it is done. */
	test: string | null;
	/** The words of a skipped unit (the "Add these as cards" action); empty otherwise. */
	skippedWords: string[];
	/** The word marks the course reaches with this unit. */
	milestones: { words: number; reached: boolean }[];
}

export interface RoadmapSection {
	id: string;
	title: string;
	levelName: string | null;
	status: Status;
	examPassed: boolean;
	/** The section exam's link while the section is not done; null for a section without an exam. */
	exam: string | null;
	units: RoadmapUnit[];
}

export interface Roadmap {
	sections: RoadmapSection[];
	/** The one next thing to do ("Continue"); null when the course is done. */
	next: { href: string; label: string; unit: string } | null;
	/** Words met in lessons. */
	met: number;
	/** Words in the course. */
	total: number;
	/** "Find your place" (#224): the first placement exam, while the learner has not started past the start; else null. */
	placement: string | null;
}

/** titleText: a course title in the interface language, else English. */
export function titleText(title: CourseTitle, language: string): string {
	return title[language] ?? title.en;
}

const KIND_LABEL = {
	script: 'courses.lesson.script',
	grammar: 'courses.lesson.grammar',
	practice: 'courses.lesson.practice',
	listening: 'courses.lesson.listening',
	speaking: 'courses.lesson.speaking',
	reading: 'courses.lesson.reading'
} as const;

/** lessonLabel: "New words 2", "Catch-up 1", "Grammar", … */
export function lessonLabel(lesson: Pick<CourseLesson, 'id' | 'kind'>): string {
	if (lesson.kind === 'words') {
		const catchUp = /^catch-up-(\d+)$/.exec(lesson.id);
		if (catchUp) return t('courses.lesson.catchUp', { n: Number(catchUp[1]) });
		const words = /^words-(\d+)$/.exec(lesson.id);
		return t('courses.lesson.words', { n: words ? Number(words[1]) : 1 });
	}
	return t(KIND_LABEL[lesson.kind]);
}

export function roadmap(course: Course, state: CourseState, language = 'en'): Roadmap {
	const href = (unit: string, lesson: string) => courseHref({ view: 'lesson', course: course.id, unit, lesson });
	const reachedWords = new Set(state.met);
	const sectionStates = new Map(state.sections.map((s) => [s.id, s]));
	// Words of skipped units count as reached (they are marked known, design §7).
	for (const s of course.sections) {
		for (const u of s.units) {
			const us = sectionStates.get(s.id)?.units.find((x) => x.id === u.id);
			if (us?.skipped) for (const w of u.words) reachedWords.add(w.key);
		}
	}
	const reached = reachedWords.size;
	let total = 0;
	let markAt = 0;
	const sections: RoadmapSection[] = course.sections.map((s) => {
		const ss = sectionStates.get(s.id)!;
		const units: RoadmapUnit[] = s.units.map((u) => {
			const us = ss.units.find((x) => x.id === u.id)!;
			const statusOf = new Map(us.lessons.map((l) => [l.id, l]));
			const lessons = u.lessons.map((l) => {
				const ls = statusOf.get(l.id) ?? { status: 'locked' as const, started: false };
				return { id: l.id, kind: l.kind, label: lessonLabel(l), status: ls.status, started: ls.started, href: ls.status === 'locked' ? null : href(u.id, l.id) };
			});
			const catchUp = us.catchUp.map((c, i) => ({
				id: c.id,
				kind: c.kind,
				label: lessonLabel(c),
				status: (i === 0 ? 'next' : 'unlocked') as LessonStatus,
				started: false,
				href: href(u.id, c.id)
			}));
			const before = total;
			total += u.words.length;
			const milestones: RoadmapUnit['milestones'] = [];
			while (markAt < MILESTONE_WORDS.length && MILESTONE_WORDS[markAt] <= total) {
				if (MILESTONE_WORDS[markAt] > before) milestones.push({ words: MILESTONE_WORDS[markAt], reached: reached >= MILESTONE_WORDS[markAt] });
				markAt += 1;
			}
			return {
				id: u.id,
				title: titleText(u.title, language),
				status: us.status,
				current: state.current?.unit === u.id,
				skipped: us.skipped,
				testPassed: us.testPassed,
				next: us.next,
				lessons,
				catchUp,
				words: u.words.length,
				test: u.test && us.status !== 'done' && !us.testPassed ? courseHref({ view: 'test', course: course.id, unit: u.id }) : null,
				skippedWords: us.skipped ? u.words.map((w) => w.key) : [],
				milestones
			};
		});
		return {
			id: s.id,
			title: titleText(s.title, language),
			levelName: s.levelName,
			status: ss.status,
			examPassed: ss.examPassed,
			exam: s.exam && ss.status !== 'done' ? courseHref({ view: 'exam', course: course.id, section: s.id }) : null,
			units
		};
	});
	let next: Roadmap['next'] = null;
	if (state.current !== null) {
		const { unit, next: lesson } = state.current;
		const u = course.sections.flatMap((s) => s.units).find((x) => x.id === unit)!;
		next =
			lesson === NEXT_TEST
				? { href: courseHref({ view: 'test', course: course.id, unit }), label: t('courses.roadmap.takeTest'), unit }
				: { href: href(unit, lesson), label: lessonLabel(u.lessons.find((l) => l.id === lesson) ?? { id: lesson, kind: 'practice' }), unit };
	} else {
		// Every unit is done: a catch-up lesson is what is left, if any.
		for (const s of sections) for (const u of s.units) if (next === null && u.catchUp.length > 0) next = { href: u.catchUp[0].href!, label: u.catchUp[0].label, unit: u.id };
	}
	// Placement is offered until a unit of a section with an exam is done or anything was skipped (#224, Ruling 15).
	const started = course.sections.some((s) => {
		const ss = sectionStates.get(s.id)!;
		return ss.units.some((u) => u.skipped || (s.exam && u.status === 'done'));
	});
	const first = placementFirst(course.sections);
	const placement = started || first === null ? null : courseHref({ view: 'placement', course: course.id, section: first });
	return { sections, next, met: state.met.length, total, placement };
}
