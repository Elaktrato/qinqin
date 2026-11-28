import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/courses', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/api/courses')>()), courses: vi.fn(), course: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/studycore/data')>()), loadStudyHistory: vi.fn() }));
vi.mock('./cards', async (importOriginal) => ({ ...(await importOriginal<typeof import('./cards')>()), markCourseKnown: vi.fn(async () => undefined), addCourseCards: vi.fn(async () => []) }));
vi.mock('./lessonData', () => ({ loadWordInfo: vi.fn(async () => new Map()), loadCharacterInfo: vi.fn(async () => new Map()) }));

import { course, courses } from '$lib/api/courses';
import type { StudyEvent } from '$lib/events';
import { loadStudyHistory } from '$lib/studycore/data';
import { testContext, type TestContext } from '$lib/testing/context';
import { history } from '$lib/testing/study';
import { addCourseCards, markCourseKnown } from './cards';
import Roadmap from './Roadmap.svelte';
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

describe('the course roadmap (#222)', () => {
	it('shows the course, the next lesson one tap away and every section and unit with its state', async () => {
		render(Roadmap, { props: { courseId: null }, context: ctx.context });
		await screen.findByRole('heading', { level: 1, name: 'Test course' });
		expect(screen.getByText('0 of 5 words met')).toBeTruthy();
		const go = screen.getByRole('link', { name: 'Continue: Listening' });
		expect(go.getAttribute('href')).toBe('/courses/play/zh-test/sounds/listening');
		expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim())).toEqual(['Start', 'Level 1 1', 'Level 2 2']);
		const current = document.querySelector('[aria-current="step"].unit') as HTMLElement;
		expect(within(current).getByRole('heading', { level: 3 }).textContent).toBe('sounds');
		// A locked unit offers its test; its lessons are summed up.
		const hello = screen.getByRole('heading', { level: 3, name: 'hello' }).closest('li')!;
		expect(within(hello).getByText('Locked')).toBeTruthy();
		expect(within(hello).getByRole('link', { name: 'Take the unit test' }).getAttribute('href')).toBe('/courses/play/zh-test/hello/test');
		expect(within(hello).getByText('5 lessons · 2 words')).toBeTruthy();
		expect(screen.getAllByRole('link', { name: 'Take the section exam' })).toHaveLength(2);
		// A fresh learner may find their place (#224).
		expect(screen.getByRole('link', { name: 'Already know some? Find your place' }).getAttribute('href')).toBe('/courses/play/zh-test/section/level-1/placement');
	});

	it('says so when the language has no course', async () => {
		vi.mocked(courses).mockResolvedValue([]);
		render(Roadmap, { props: { courseId: null }, context: ctx.context });
		await screen.findByText('There is no course for this language yet.');
	});

	it('marks the words of skipped units known once, and offers them as cards', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ courseEvents: [ev('1', { kind: 'placement', section: 'level-2' })] }));
		render(Roadmap, { props: { courseId: null }, context: ctx.context });
		await screen.findByRole('heading', { level: 1, name: 'Test course' });
		await waitFor(() => expect(markCourseKnown).toHaveBeenCalledTimes(1));
		expect(vi.mocked(markCourseKnown).mock.calls[0][3]).toEqual(['你好', '谢谢', '学习']);
		const hello = screen.getByRole('heading', { level: 3, name: 'hello' }).closest('li')!;
		expect(within(hello).getByText('Skipped')).toBeTruthy();
		within(hello).getByRole('button', { name: 'Add these as cards' }).click();
		await waitFor(() => expect(addCourseCards).toHaveBeenCalledTimes(1));
		expect(vi.mocked(addCourseCards).mock.calls[0][3].map((w) => (w as unknown as { key: string }).key)).toEqual(['你好', '谢谢']);
		await screen.findByText('These words already have cards.');
	});

	it('shows the held course at once on a second visit, without waiting for the server', async () => {
		render(Roadmap, { props: { courseId: null }, context: ctx.context });
		await screen.findByRole('heading', { level: 1, name: 'Test course' });
		cleanup();
		vi.mocked(course).mockReturnValue(new Promise(() => {}));
		vi.mocked(courses).mockReturnValue(new Promise(() => {}));
		render(Roadmap, { props: { courseId: null }, context: ctx.context });
		await screen.findByRole('heading', { level: 1, name: 'Test course' });
	});
});
