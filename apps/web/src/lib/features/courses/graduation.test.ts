import { describe, expect, it } from 'vitest';
import type { StudyEvent } from '$lib/events';
import { freeStudyGuide, graduated } from './graduation';
import { courseState } from './progress';
import { testCourse } from './testing/course';

const course = testCourse();
const ev = (id: string, payload: Record<string, unknown>): StudyEvent => ({ id, workspaceId: 7, device: 'web', ts: `2026-11-28T08:00:0${id}Z`, type: 'course', payload: { course: 'zh-test', ...payload } });

describe('leaving the course (#225)', () => {
	it('a course is graduated when every unit is done, not before', () => {
		expect(graduated(courseState(course, { courseEvents: [], known: [] }))).toBe(false);
		const one = courseState(course, { courseEvents: [ev('1', { kind: 'section-exam', section: 'level-1', score: 1, total: 1, passed: true })], known: [] });
		expect(graduated(one)).toBe(false);
		const all = courseState(course, { courseEvents: [ev('1', { kind: 'section-exam', section: 'level-2', score: 1, total: 1, passed: true })], known: [] });
		expect(graduated(all)).toBe(true);
	});

	it('the guide to free study: decks, a level session, the reader and grammar, each while its feature is on', () => {
		expect(freeStudyGuide(() => true).map((g) => g.href)).toEqual(['/flashcards', '/study', '/reader', '/grammar']);
		expect(freeStudyGuide((id) => id !== 'reader').map((g) => g.href)).toEqual(['/flashcards', '/study', '/grammar']);
		// Level sessions are flashcards' too.
		expect(freeStudyGuide((id) => id !== 'flashcards').map((g) => g.href)).toEqual(['/reader', '/grammar']);
		for (const g of freeStudyGuide(() => true)) {
			expect(g.title.length).toBeGreaterThan(0);
			expect(g.text.length).toBeGreaterThan(0);
		}
	});
});
