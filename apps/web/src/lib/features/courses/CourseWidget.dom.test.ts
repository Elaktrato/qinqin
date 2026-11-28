import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/courses', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/api/courses')>()), courses: vi.fn(), course: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/studycore/data')>()), loadStudyHistory: vi.fn() }));

import { course, courses } from '$lib/api/courses';
import type { StudyEvent } from '$lib/events';
import { loadStudyHistory } from '$lib/studycore/data';
import { testContext, type TestContext } from '$lib/testing/context';
import { history } from '$lib/testing/study';
import CourseWidget from './CourseWidget.svelte';
import { testCourse } from './testing/course';

let ctx: TestContext;
const ws = { id: 7, language: 'zh', name: '', settings: {}, updatedAt: '' } as never;
const info = { id: 'zh-test', name: 'Test course', version: '1', language: 'zh', license: 'CC-BY-4.0', attribution: 'tests', notice: '', title: { en: 'Test course' } };
const ev = (id: string, payload: Record<string, unknown>): StudyEvent => ({ id, workspaceId: 7, device: 'web', ts: `2026-11-28T08:00:0${id}Z`, type: 'course', payload: { course: 'zh-test', ...payload } });

beforeEach(() => {
	ctx = testContext();
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.mocked(courses).mockResolvedValue([info]);
	vi.mocked(course).mockResolvedValue(testCourse());
	vi.mocked(loadStudyHistory).mockResolvedValue(history());
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('Continue course on Home (#225)', () => {
	it('a fresh learner starts the course with one tap', async () => {
		render(CourseWidget, { context: ctx.context });
		await screen.findByRole('heading', { level: 2, name: 'Test course' });
		expect(screen.getByText('Start at the very beginning, one short lesson at a time.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Start: Listening' }).getAttribute('href')).toBe('/courses/play/zh-test/sounds/listening');
		expect(screen.getByRole('link', { name: 'Roadmap' }).getAttribute('href')).toBe('/courses');
		expect(screen.getByText('0 of 4 units done · 0 of 5 words met')).toBeTruthy();
	});

	it('midway, it names the section and unit and continues at the next lesson', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({
				courseEvents: [
					ev('1', { kind: 'lesson-finished', unit: 'sounds', lesson: 'listening', score: 1, total: 1, words: [] }),
					ev('2', { kind: 'lesson-finished', unit: 'hello', lesson: 'script', score: 1, total: 1, words: [] })
				]
			})
		);
		render(CourseWidget, { context: ctx.context });
		await screen.findByText('Level 1 · hello');
		expect(screen.getByRole('link', { name: 'Continue: New words 1' }).getAttribute('href')).toBe('/courses/play/zh-test/hello/words-1');
		expect(screen.getByText('1 of 4 units done · 0 of 5 words met')).toBeTruthy();
	});

	it('a finished course points to what comes next', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ courseEvents: [ev('1', { kind: 'section-exam', section: 'level-2', score: 1, total: 1, passed: true })] }));
		render(CourseWidget, { context: ctx.context });
		await screen.findByText('You have finished the course.');
		expect(screen.getByRole('link', { name: 'See what comes next' }).getAttribute('href')).toBe('/courses');
	});

	it('shows nothing at all when the language has no course, or the course cannot be read', async () => {
		vi.mocked(courses).mockResolvedValue([]);
		const { container } = render(CourseWidget, { context: ctx.context });
		await waitFor(() => expect(courses).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(container.textContent?.trim()).toBe('');
		cleanup();
		vi.mocked(courses).mockRejectedValue(new TypeError('offline'));
		const again = render(CourseWidget, { context: testContext().context });
		await new Promise((r) => setTimeout(r, 0));
		expect(again.container.textContent?.trim()).toBe('');
	});
});
