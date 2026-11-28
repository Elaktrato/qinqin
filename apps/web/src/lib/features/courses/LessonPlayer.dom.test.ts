import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/courses', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/api/courses')>()), courses: vi.fn(), course: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/studycore/data')>()), loadStudyHistory: vi.fn() }));
vi.mock('./cards', async (importOriginal) => ({
	...(await importOriginal<typeof import('./cards')>()),
	addCourseCards: vi.fn(async () => [{ id: 'c-vocab-101', kind: 'vocab', entryId: 101, deckIds: ['d-course-zh-test'], createdAt: '' }]),
	recordFirstReviews: vi.fn(async () => undefined)
}));
vi.mock('./lessonData', () => ({ loadWordInfo: vi.fn(), loadCharacterInfo: vi.fn(async () => new Map()) }));

import { course, courses } from '$lib/api/courses';
import type { StudyEventBody } from '$lib/api/types';
import { loadStudyHistory } from '$lib/studycore/data';
import { testContext, type TestContext } from '$lib/testing/context';
import { history } from '$lib/testing/study';
import { addCourseCards, recordFirstReviews } from './cards';
import { loadWordInfo } from './lessonData';
import LessonPlayer from './LessonPlayer.svelte';
import { testCourse } from './testing/course';

let ctx: TestContext;
let recorded: StudyEventBody[];
const ws = { id: 7, language: 'zh', name: '', settings: { 'audio.deviceVoice': false }, updatedAt: '' } as never;
const info = { id: 'zh-test', name: 'Test course', version: '1', language: 'zh', license: 'CC-BY-4.0', attribution: '', notice: '', title: { en: 'Test course' } };
const GLOSS: Record<string, string> = { 你好: 'hello', 谢谢: 'thanks', 学习: 'to study' };

beforeEach(() => {
	ctx = testContext();
	ctx.session.workspaces.set({ list: [ws], current: ws });
	recorded = [];
	vi.spyOn(ctx.session.outbox, 'recordEvent').mockImplementation(async (e) => (recorded.push(e), e));
	vi.mocked(courses).mockResolvedValue([info]);
	vi.mocked(course).mockResolvedValue(testCourse());
	vi.mocked(loadStudyHistory).mockResolvedValue(history());
	vi.mocked(loadWordInfo).mockImplementation(async (words) => new Map(words.map((w) => [w.key, { key: w.key, form: w.form, reading: w.reading, entryId: w.entryId, gloss: GLOSS[w.key] ?? null }])));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function answerAll(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		const ask = document.querySelector('.question');
		if (!ask) return;
		const prompt = ask.querySelector('.prompt')?.textContent ?? '';
		const answer = Object.entries(GLOSS).find(([k, g]) => k === prompt || g === prompt);
		const want = answer ? (answer[0] === prompt ? answer[1] : answer[0]) : '';
		await fireEvent.click(screen.getByRole('button', { name: want }));
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
	}
}

describe('the lesson player (#222)', () => {
	it('a word lesson of the current unit runs through and ends in a summary', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ courseEvents: [{ id: 'a', workspaceId: 7, device: 'web', ts: '2026-11-28T08:00:00Z', type: 'course', payload: { kind: 'lesson-finished', course: 'zh-test', unit: 'sounds', lesson: 'listening', score: 0, total: 0, words: [] } },
				{ id: 'b', workspaceId: 7, device: 'web', ts: '2026-11-28T08:01:00Z', type: 'course', payload: { kind: 'lesson-finished', course: 'zh-test', unit: 'hello', lesson: 'script', score: 0, total: 0, words: [] } }
			] })
		);
		render(LessonPlayer, { props: { route: { view: 'lesson', course: 'zh-test', unit: 'hello', lesson: 'words-1' } }, context: ctx.context });
		await screen.findByLabelText('New word');
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await answerAll();
		await screen.findByRole('heading', { level: 1, name: 'Lesson done' });
		expect(screen.getByText('4 of 4 right the first time')).toBeTruthy();
		expect(recorded.map((e) => (e.payload as { kind: string }).kind)).toEqual(['lesson-started', 'lesson-finished']);
		expect(recorded[1].payload).toMatchObject({ unit: 'hello', lesson: 'words-1', score: 4, total: 4, words: ['你好', '谢谢'] });
		expect(addCourseCards).toHaveBeenCalledTimes(1);
		expect(vi.mocked(recordFirstReviews).mock.calls[0][3]).toEqual(new Map([[101, 3], [102, 3]]));
	});

	it('a locked lesson says so and offers the way back', async () => {
		render(LessonPlayer, { props: { route: { view: 'lesson', course: 'zh-test', unit: 'money', lesson: 'words-1' } }, context: ctx.context });
		await screen.findByText(/still locked/);
		expect(recorded).toEqual([]);
	});

	it('the unit test records its result against the pass mark, early when lessons are open', async () => {
		render(LessonPlayer, { props: { route: { view: 'test', course: 'zh-test', unit: 'hello' } }, context: ctx.context });
		await screen.findByText('What does it mean?');
		await answerAll();
		await screen.findByRole('heading', { level: 1, name: 'Passed' });
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].payload).toEqual({ kind: 'unit-test', course: 'zh-test', unit: 'hello', score: 4, total: 4, passed: true, early: true });
	});
});
