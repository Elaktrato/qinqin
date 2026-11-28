import { describe, expect, it } from 'vitest';
import { courseStartApplies, courseStartDismissKey, isCourseStartDismissed, setCourseStartDismissed, shouldOfferCourseStart, type CourseStartFacts } from './startOffer';
import { memoryStorage } from '$lib/testing/context';

const fresh: CourseStartFacts = { coursesOn: true, hasCourse: true, cards: 0, marks: 0, courseEvents: 0, dismissed: false };

describe('the course start card on Home (#225)', () => {
	it('shows for a fresh workspace whose language has a course', () => {
		expect(shouldOfferCourseStart(fresh)).toBe(true);
	});

	it('does not show once anything exists, after Not now, with Courses off or without a course', () => {
		for (const over of [{ cards: 1 }, { marks: 1 }, { courseEvents: 1 }, { dismissed: true }, { coursesOn: false }, { hasCourse: false }]) {
			expect(shouldOfferCourseStart({ ...fresh, ...over }), JSON.stringify(over)).toBe(false);
		}
	});

	it('takes the place of the Starter and placement offers whenever a course applies, shown or not', () => {
		expect(courseStartApplies(fresh)).toBe(true);
		expect(courseStartApplies({ ...fresh, dismissed: true, cards: 3 })).toBe(true);
		expect(courseStartApplies({ ...fresh, hasCourse: false })).toBe(false);
		expect(courseStartApplies({ ...fresh, coursesOn: false })).toBe(false);
	});

	it('remembers Not now per workspace on this device; denied storage forgets quietly', () => {
		const storage = memoryStorage();
		expect(isCourseStartDismissed(storage, 4)).toBe(false);
		setCourseStartDismissed(storage, 4);
		expect(isCourseStartDismissed(storage, 4)).toBe(true);
		expect(isCourseStartDismissed(storage, 5)).toBe(false);
		expect(courseStartDismissKey(4)).toBe('qinqin.courseStart.dismissed.4');
		const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
		expect(isCourseStartDismissed(denied, 4)).toBe(false);
		expect(() => setCourseStartDismissed(denied, 4)).not.toThrow();
	});
});
