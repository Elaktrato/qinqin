import { describe, expect, it } from 'vitest';
import { courseHref, parseCourseRoute, type CourseRoute } from './route';

describe('course routes (#222)', () => {
	const cases: [string, CourseRoute][] = [
		['', { view: 'roadmap', course: null }],
		['zh-course', { view: 'roadmap', course: 'zh-course' }],
		['play/zh-course/hello/words-1', { view: 'lesson', course: 'zh-course', unit: 'hello', lesson: 'words-1' }],
		['play/zh-course/hello/test', { view: 'test', course: 'zh-course', unit: 'hello' }],
		['play/zh-course/section/level-1/exam', { view: 'exam', course: 'zh-course', section: 'level-1' }]
	];
	it.each(cases)('parses %s and builds it back', (rest, route) => {
		expect(parseCourseRoute(rest)).toEqual(route);
		expect(courseHref(route)).toBe(rest === '' ? '/courses' : `/courses/${rest}`);
	});

	it('reads anything else as the roadmap of the workspace course', () => {
		for (const rest of ['play', 'play/zh-course', 'a/b', 'play/x/y/z/w', 'play/x/section/y/test']) {
			expect(parseCourseRoute(rest)).toEqual({ view: 'roadmap', course: null });
		}
	});

	it('escapes a course id in a link and reads it back', () => {
		const route: CourseRoute = { view: 'lesson', course: 'a b', unit: 'u', lesson: 'l' };
		expect(courseHref(route)).toBe('/courses/play/a%20b/u/l');
		expect(parseCourseRoute('play/a%20b/u/l')).toEqual(route);
	});
});
