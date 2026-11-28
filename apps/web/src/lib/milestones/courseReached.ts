// Course milestones (#225, docs/contracts/milestones/course.json): the first lesson, each unit done by its own work,
// each section, each script, the characters and words of the course, and graduation. One pass over the workspace's
// events of its course with the derivation's own replay (studycore/courseProgress.ts CourseReplay), checking after
// each event what now holds. Pure.

import type { StudyEvent } from '$lib/events';
import { systemLabel } from '$lib/features/scripts/labels';
import { CourseReplay, courseEventsOf, type DeriveCourse } from '$lib/studycore/courseProgress';
import type { StudyDay } from '$lib/time/studyDay';
import { FAMILIES, compareIds, courseMilestoneId } from './catalogue';
import type { Reached } from './reached';

/** What the course rule reads of a filled course (`Course` of lib/api/courses.ts has it all). */
export interface MilestoneCourse {
	id: string;
	sections: readonly {
		id: string;
		units: readonly (DeriveCourse['sections'][number]['units'][number] & {
			characters: readonly string[];
			scripts: readonly string[];
		})[];
	}[];
}

const thresholdsOf = (family: string): readonly number[] => FAMILIES.find((f) => f.family === family)?.thresholds ?? [];

/**
 * reachedFromCourse: the course milestones of a workspace's events (any workspace's events may be passed: only the
 * course's are read; the caller filters by workspace), ordered by instant, then catalogue order.
 */
export function reachedFromCourse(course: MilestoneCourse, events: readonly StudyEvent[], day: StudyDay, now: number): Reached[] {
	const out: Reached[] = [];
	const replay = new CourseReplay(course);
	const units = replay.order.map((_, i) => replay.unit(i) as MilestoneCourse['sections'][number]['units'][number]);
	const sectionOf = replay.order.map((r) => r.section);
	const done = units.map(() => false);
	const sectionDone = course.sections.map(() => false);
	const scripts = new Map<string, number[]>();
	units.forEach((u, i) => {
		for (const s of u.scripts) scripts.set(s, [...(scripts.get(s) ?? []), i]);
	});
	const scriptDone = new Set<string>();
	const reached = new Set<string>();
	const words = new Set<string>();
	let characters = 0;
	let started = false;
	let graduated = false;
	let charAt = 0;
	let wordAt = 0;
	const charThresholds = thresholdsOf('course-characters');
	const wordThresholds = thresholdsOf('course-words');

	for (const p of courseEventsOf(course.id, events)) {
		if (p.at > now) break;
		replay.apply(p);
		const at = p.at;
		const date = day.dayOf(at);
		const reach = (id: string): void => {
			if (!reached.has(id)) {
				reached.add(id);
				out.push({ id, at, day: date });
			}
		};
		if (!started && p.kind === 'lesson-finished') {
			started = true;
			reach(courseMilestoneId('course-started', course.id));
		}
		for (const w of p.words) words.add(w);
		units.forEach((u, i) => {
			if (done[i] || !replay.done(i)) return;
			done[i] = true;
			characters += u.characters.length;
			if (replay.passed[i] === 2) for (const w of u.words) words.add(w.key);
			const own = p.unit === u.id && ((p.kind === 'unit-test' && p.passed) || (p.kind === 'lesson-finished' && !u.test));
			if (own) reach(courseMilestoneId('course-unit', course.id, u.id));
		});
		course.sections.forEach((s, si) => {
			if (sectionDone[si] || !sectionOf.every((sec, i) => sec !== si || done[i])) return;
			sectionDone[si] = true;
			reach(courseMilestoneId('course-section', course.id, s.id));
		});
		for (const [script, at] of scripts) {
			if (!scriptDone.has(script) && at.every((i) => done[i])) {
				scriptDone.add(script);
				reach(courseMilestoneId('course-script', course.id, script));
			}
		}
		while (charAt < charThresholds.length && characters >= charThresholds[charAt]) {
			reach(courseMilestoneId('course-characters', course.id, charThresholds[charAt]));
			charAt += 1;
		}
		while (wordAt < wordThresholds.length && words.size >= wordThresholds[wordAt]) {
			reach(courseMilestoneId('course-words', course.id, wordThresholds[wordAt]));
			wordAt += 1;
		}
		if (!graduated && units.length > 0 && done.every(Boolean)) {
			graduated = true;
			reach(courseMilestoneId('course-graduated', course.id));
		}
	}
	return out.sort((a, b) => a.at - b.at || compareIds(a.id, b.id));
}

type Title = Record<string, string>;
const titleIn = (title: Title, language: string): string => title[language] ?? title.en ?? '';

/**
 * courseNames: the names milestoneTitle reads for a course: `course:<id>` its title, `course:<id>:section:<s>`,
 * `course:<id>:unit:<u>`, and `script:<script>` the script's interface name.
 */
export function courseNames(
	course: { id: string; title: Title; sections: readonly { id: string; title: Title; units: readonly { id: string; title: Title; scripts: readonly string[] }[] }[] },
	language: string
): Map<string, string> {
	const out = new Map<string, string>([[`course:${course.id}`, titleIn(course.title, language)]]);
	for (const s of course.sections) {
		out.set(`course:${course.id}:section:${s.id}`, titleIn(s.title, language));
		for (const u of s.units) {
			out.set(`course:${course.id}:unit:${u.id}`, titleIn(u.title, language));
			for (const script of u.scripts) out.set(`script:${script}`, systemLabel(script));
		}
	}
	return out;
}
