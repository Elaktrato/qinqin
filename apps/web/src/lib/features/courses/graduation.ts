// Leaving the course (#225, plan Rulings 24–25): once every unit is done the learner graduates (the milestone
// `course-graduated`), and the roadmap shows a short guide to studying freely: their decks, level sessions, the
// reader and grammar beyond the course. Pure.

import { t } from '$lib/i18n';
import type { CourseState } from '$lib/studycore/courseProgress';

/** graduated: every unit of the course is done. */
export function graduated(state: CourseState): boolean {
	const units = state.sections.flatMap((s) => s.units);
	return units.length > 0 && units.every((u) => u.status === 'done');
}

export interface GuideItem {
	href: string;
	title: string;
	text: string;
}

const GUIDE = [
	{ feature: 'flashcards', href: '/flashcards', title: 'courses.graduation.decks.title', text: 'courses.graduation.decks.text' },
	{ feature: 'flashcards', href: '/study', title: 'courses.graduation.levels.title', text: 'courses.graduation.levels.text' },
	{ feature: 'reader', href: '/reader', title: 'courses.graduation.reader.title', text: 'courses.graduation.reader.text' },
	{ feature: 'grammar', href: '/grammar', title: 'courses.graduation.grammar.title', text: 'courses.graduation.grammar.text' }
] as const;

/** freeStudyGuide: where to go next, each place while its feature is on (`on` says which are). */
export function freeStudyGuide(on: (feature: string) => boolean): GuideItem[] {
	return GUIDE.filter((g) => on(g.feature)).map((g) => ({ href: g.href, title: t(g.title), text: t(g.text) }));
}
