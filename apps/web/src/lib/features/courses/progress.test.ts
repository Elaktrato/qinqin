import { describe, expect, it } from 'vitest';
import type { StudyEvent } from '$lib/events';
import { courseEvent, courseState, knownKeys, recordCourseEvent, wordsByKey } from './progress';
import { testCourse } from './testing/course';

const course = testCourse();

function ev(id: string, ts: string, payload: Record<string, unknown>): StudyEvent {
	return { id, workspaceId: 7, device: 'web', ts, type: 'course', payload: { course: 'zh-test', ...payload } };
}

describe('course progress (#222)', () => {
	it('knownKeys: the course words whose entry carries a known mark', () => {
		expect(knownKeys(course, [102, 999])).toEqual(['谢谢']);
		expect(knownKeys(course, [])).toEqual([]);
	});

	it('wordsByKey indexes every course word once', () => {
		const words = wordsByKey(course);
		expect(words.get('你好')?.entryId).toBe(101);
		expect(words.size).toBe(5);
	});

	it('courseState replays the history over the course: a finished lesson moves the unit on', () => {
		const fresh = courseState(course, { courseEvents: [], known: [] });
		expect(fresh.current).toEqual({ section: 'start', unit: 'sounds', next: 'listening' });
		const events = [ev('a', '2026-11-28T08:00:00Z', { kind: 'lesson-finished', unit: 'sounds', lesson: 'listening', score: 0, total: 0, words: [] })];
		const state = courseState(course, { courseEvents: events, known: [] });
		expect(state.current).toEqual({ section: 'level-1', unit: 'hello', next: 'script' });
	});

	it('courseState passes the known marks as keys: a skipped unit outputs only unmarked words', () => {
		const events = [ev('a', '2026-11-28T08:00:00Z', { kind: 'placement', section: 'level-2' })];
		expect(courseState(course, { courseEvents: events, known: [] }).known).toEqual(['你好', '谢谢', '学习']);
		expect(courseState(course, { courseEvents: events, known: [102] }).known).toEqual(['你好', '学习']);
	});

	it('courseEvent builds the event in the contract order, stamped now', () => {
		const event = courseEvent(7, { kind: 'lesson-finished', course: 'zh-test', unit: 'hello', lesson: 'words-1', score: 3, total: 4, words: ['你好'] }, Date.parse('2026-11-28T09:00:00Z'));
		expect(event).toMatchObject({ workspaceId: 7, device: 'web', ts: '2026-11-28T09:00:00.000Z', type: 'course' });
		expect(JSON.stringify(event.payload)).toBe(
			'{"kind":"lesson-finished","course":"zh-test","unit":"hello","lesson":"words-1","score":3,"total":4,"words":["你好"]}'
		);
		expect(event.id).toMatch(/^[0-9A-Z]{26}$/);
	});

	it('recordCourseEvent writes through the outbox and throws when the workspace is gone', async () => {
		const kept: unknown[] = [];
		const outbox = { recordEvent: async (e: unknown) => (kept.push(e), e as never) };
		const event = courseEvent(7, { kind: 'lesson-started', course: 'zh-test', unit: 'hello', lesson: 'script' });
		await expect(recordCourseEvent({ outbox }, event)).resolves.toBe(event);
		expect(kept).toEqual([event]);
		await expect(recordCourseEvent({ outbox: { recordEvent: async () => null } }, event)).rejects.toThrow();
	});
});
