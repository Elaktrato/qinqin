import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/courses', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/api/courses')>()), courses: vi.fn(), course: vi.fn() }));

import { course, courses, type CourseInfo } from '$lib/api/courses';
import { memoryStorage, newSession, testContext, type TestContext } from '$lib/testing/context';
import { COURSE_COPY_PREFIX, chosenCourse, heldCourse, heldCourseList, pickCourse, refreshCourse, refreshCourseList, workspaceCourse } from './courseData';
import { testCourse } from './testing/course';

const info = (id: string, language = 'zh'): CourseInfo => ({ id, name: id, version: '1', language, license: 'CC-BY-4.0', attribution: '', notice: '', title: { en: id } });

let ctx: TestContext;
let localStorage: Storage;
beforeEach(() => {
	localStorage = memoryStorage();
	ctx = testContext({ deps: { local: () => localStorage } });
	vi.mocked(courses).mockResolvedValue([info('zh-b'), info('zh-a')]);
	vi.mocked(course).mockResolvedValue(testCourse());
});
afterEach(() => vi.clearAllMocks());

const copyKeys = () => [...Array(localStorage.length)].map((_, i) => localStorage.key(i)!).filter((k) => k.startsWith(COURSE_COPY_PREFIX));

describe('the course of a workspace (#225)', () => {
	it('reads the list and the course once, then answers from what is held', async () => {
		vi.mocked(course).mockImplementation(async (id: string) => ({ ...testCourse(), id }));
		const first = await workspaceCourse(ctx.session, { id: 1, language: 'zh' });
		expect(first?.id).toBe('zh-a');
		expect(courses).toHaveBeenCalledTimes(1);
		expect(course).toHaveBeenCalledTimes(1);
		expect((await workspaceCourse(ctx.session, { id: 1, language: 'zh' }))?.id).toBe('zh-a');
		expect(courses).toHaveBeenCalledTimes(1);
		expect(course).toHaveBeenCalledTimes(1);
	});

	it('is null without a course for the language, and when the server cannot be read', async () => {
		vi.mocked(courses).mockResolvedValueOnce([]);
		expect(await workspaceCourse(ctx.session, { id: 1, language: 'de' })).toBeNull();
		vi.mocked(courses).mockRejectedValueOnce(new TypeError('offline'));
		expect(await workspaceCourse(ctx.session, { id: 1, language: 'ko' })).toBeNull();
	});
});

describe('the course data held for the session and the device (#222)', () => {
	it('holds nothing before the first read; a read holds the list per language, by pack id', async () => {
		expect(heldCourseList(ctx.session, 'zh')).toBeNull();
		expect((await refreshCourseList(ctx.session, 'zh')).map((c) => c.id)).toEqual(['zh-a', 'zh-b']);
		expect(courses).toHaveBeenCalledWith('zh');
		expect(heldCourseList(ctx.session, 'zh')?.map((c) => c.id)).toEqual(['zh-a', 'zh-b']);
		expect(heldCourseList(ctx.session, 'ja')).toBeNull();
	});

	it('holds a filled course and keeps a device copy for a new session of the same user only', async () => {
		expect(heldCourse(ctx.session, 'zh-test')).toBeNull();
		await refreshCourse(ctx.session, 'zh-test');
		expect(heldCourse(ctx.session, 'zh-test')?.fill).toBe('f1');
		newSession(ctx, 'expired');
		expect(heldCourse(ctx.session, 'zh-test')?.fill).toBe('f1');
		const other = testContext({ user: { id: 2, username: 'bo' }, deps: { local: () => localStorage } });
		expect(heldCourse(other.session, 'zh-test')).toBeNull();
	});

	it('a failed refresh keeps what is held; a course the server no longer has (null) is not held', async () => {
		await refreshCourse(ctx.session, 'zh-test');
		vi.mocked(course).mockRejectedValueOnce(new TypeError('offline'));
		await expect(refreshCourse(ctx.session, 'zh-test')).rejects.toThrow('offline');
		expect(heldCourse(ctx.session, 'zh-test')?.fill).toBe('f1');
		vi.mocked(course).mockResolvedValueOnce(null);
		expect(await refreshCourse(ctx.session, 'zh-gone')).toBeNull();
		expect(heldCourse(ctx.session, 'zh-gone')).toBeNull();
	});

	it('a copy that cannot be read or is not a course reads as nothing', () => {
		localStorage.setItem(`${COURSE_COPY_PREFIX}${ctx.session.user}.zh-test`, '{not json');
		expect(heldCourse(ctx.session, 'zh-test')).toBeNull();
		localStorage.setItem(`${COURSE_COPY_PREFIX}${ctx.session.user}.zh-test`, JSON.stringify({ fill: 'x' }));
		expect(heldCourse(ctx.session, 'zh-test')).toBeNull();
	});

	it('a sign-out removes the device copies', async () => {
		await refreshCourseList(ctx.session, 'zh');
		await refreshCourse(ctx.session, 'zh-test');
		pickCourse(ctx.session, 5, 'zh-b');
		expect(copyKeys().length).toBeGreaterThan(0);
		newSession(ctx, 'signOut');
		expect(copyKeys()).toEqual([]);
		expect(heldCourse(ctx.session, 'zh-test')).toBeNull();
	});

	it('an answer that lands after the session ended is not held', async () => {
		let resolve!: (v: ReturnType<typeof testCourse>) => void;
		vi.mocked(course).mockReturnValueOnce(new Promise((r) => (resolve = r)));
		const old = ctx.session;
		const running = refreshCourse(old, 'zh-test');
		newSession(ctx, 'expired');
		resolve(testCourse());
		await running;
		expect(heldCourse(ctx.session, 'zh-test')).toBeNull();
	});

	it('chosenCourse: the learner pick on this device for the workspace, else the first by pack id (Ruling 6)', () => {
		const list = [info('zh-a'), info('zh-b')];
		expect(chosenCourse(ctx.session, 5, list)?.id).toBe('zh-a');
		pickCourse(ctx.session, 5, 'zh-b');
		expect(chosenCourse(ctx.session, 5, list)?.id).toBe('zh-b');
		expect(chosenCourse(ctx.session, 6, list)?.id).toBe('zh-a');
		expect(chosenCourse(ctx.session, 5, [info('zh-a')])?.id).toBe('zh-a');
		expect(chosenCourse(ctx.session, 5, [])).toBeNull();
	});
});
