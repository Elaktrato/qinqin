// docs/contracts/milestones/course.json: the course milestones (#225), reached at the first course event after which
// they hold, over the workspace's filled course.

import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/milestones/course.json';
import type { StudyEvent } from '$lib/events';
import { studyDay, type ZoneChange } from '$lib/time/studyDay';
import { courseNames, reachedFromCourse, type MilestoneCourse } from './courseReached';

interface Case {
	name: string;
	note: string;
	history: ZoneChange[];
	now: string;
	course: MilestoneCourse & { title: Record<string, string> };
	events: StudyEvent[];
	expect: { id: string; reachedAt: string; reachedDay: string }[];
}
const cases = (fixture as unknown as { rule: string; cases: Case[] }).cases;

describe('milestones/course.json', () => {
	it('is the course rule', () => {
		expect((fixture as { rule: string }).rule).toBe('milestones/course');
	});

	it.each(cases)('$name', (c) => {
		const got = reachedFromCourse(c.course, c.events, studyDay(c.history), Date.parse(c.now));
		expect(got.map((r) => ({ id: r.id, reachedAt: new Date(r.at).toISOString().replace('.000Z', 'Z'), reachedDay: r.day }))).toEqual(c.expect);
	});

	it('the same events in another arrival order reach the same', () => {
		const c = cases[0];
		const day = studyDay(c.history);
		expect(reachedFromCourse(c.course, [...c.events].reverse(), day, Date.parse(c.now))).toEqual(reachedFromCourse(c.course, c.events, day, Date.parse(c.now)));
	});
});

describe('courseNames', () => {
	it('names the course, its units, sections and scripts in the interface language, else English', () => {
		const course = {
			id: 'c',
			title: { en: 'Chinese', de: 'Chinesisch' },
			sections: [{ id: 's', title: { en: 'Start' }, units: [{ id: 'u', title: { en: 'Kana' }, scripts: ['hiragana'] }] }]
		};
		const names = courseNames(course, 'de');
		expect(names.get('course:c')).toBe('Chinesisch');
		expect(names.get('course:c:section:s')).toBe('Start');
		expect(names.get('course:c:unit:u')).toBe('Kana');
		expect(names.get('script:hiragana')).toBe('Hiragana');
	});
});
