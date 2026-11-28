// docs/contracts/courses/home.json: the model of Home's "Continue course" widget (#225).

import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../docs/contracts/courses/home.json';
import type { StudyEvent } from '$lib/events';
import { deriveCourseState } from '$lib/studycore/courseProgress';
import { courseHome, type HomeCourse } from './home';

interface Fixture {
	rule: string;
	course: HomeCourse;
	cases: { name: string; events: StudyEvent[]; known: string[]; expect: unknown }[];
}
const f = fixture as unknown as Fixture;

describe('courses/home.json', () => {
	it('is the home rule', () => expect(f.rule).toBe('courses/home'));

	it.each(f.cases)('$name', (c) => {
		const state = deriveCourseState(f.course, f.course.id, c.events, c.known);
		expect(courseHome(f.course, state)).toEqual(c.expect);
	});
});
