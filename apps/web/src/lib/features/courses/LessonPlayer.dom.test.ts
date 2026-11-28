import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
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
vi.mock('./lessonData', async (importOriginal) => ({
	...(await importOriginal<typeof import('./lessonData')>()),
	loadWordInfo: vi.fn(),
	loadCharacterInfo: vi.fn(async () => new Map()),
	loadGrammarItems: vi.fn(async () => new Map())
}));

import { course, courses } from '$lib/api/courses';
import type { StudyEventBody } from '$lib/api/types';
import { loadStudyHistory } from '$lib/studycore/data';
import { testContext, type TestContext } from '$lib/testing/context';
import { history } from '$lib/testing/study';
import { addCourseCards, recordFirstReviews } from './cards';
import { loadGrammarItems, loadWordInfo } from './lessonData';
import LessonPlayer from './LessonPlayer.svelte';
import { testCourse } from './testing/course';

let ctx: TestContext;
let recorded: StudyEventBody[];
const ws = { id: 7, language: 'zh', name: '', settings: { 'audio.deviceVoice': false }, updatedAt: '' } as never;
const info = { id: 'zh-test', name: 'Test course', version: '1', language: 'zh', license: 'CC-BY-4.0', attribution: '', notice: '', title: { en: 'Test course' } };
const GLOSS: Record<string, string> = { 你好: 'hello', 谢谢: 'thanks', 学习: 'to study', 银行: 'bank', 中国: 'China' };
const READING: Record<string, string> = { 你好: 'nǐ hǎo', 谢谢: 'xiè xie', 学习: 'xué xí', 银行: 'yín háng', 中国: 'zhōng guó' };

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

/** The right answer to the question shown (the test data's glosses, readings and the grammar item's gap). */
function rightAnswer(ask: Element): string {
	const prompt = ask.querySelector('.prompt')?.textContent?.trim() ?? '';
	const question = ask.querySelector('.ask')?.textContent ?? '';
	if (question.startsWith('How is it read')) return READING[prompt];
	if (question.startsWith('Fill the gap')) return '是';
	const answer = Object.entries(GLOSS).find(([k, g]) => k === prompt || g === prompt);
	return answer ? (answer[0] === prompt ? answer[1] : answer[0]) : '';
}

async function answerAll(opts: { right: boolean } = { right: true }): Promise<number> {
	let asked = 0;
	for (let i = 0; i < 30; i++) {
		const ask = document.querySelector('.question');
		if (!ask) return asked;
		const want = rightAnswer(ask);
		const choices = [...ask.querySelectorAll<HTMLButtonElement>('.choice')];
		const pick = opts.right ? choices.find((c) => c.textContent?.trim() === want) : choices.find((c) => c.textContent?.trim() !== want);
		await fireEvent.click(pick!);
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		asked += 1;
	}
	return asked;
}

const grammarItems = () =>
	new Map([['g:shi', [{ id: 'e1', before: '我', after: '学生。', answer: '是', choices: ['是', '有', '在'], translation: 'I am a student.', title: 'The verb 是' }]]]);

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
		vi.mocked(loadGrammarItems).mockResolvedValue(grammarItems());
		render(LessonPlayer, { props: { route: { view: 'test', course: 'zh-test', unit: 'hello' } }, context: ctx.context });
		await waitFor(() => expect(document.querySelector('.question')).not.toBeNull());
		await answerAll();
		await screen.findByRole('heading', { level: 1, name: 'Passed' });
		await waitFor(() => expect(recorded).toHaveLength(1));
		// Two words, two questions each, and the unit's grammar point.
		expect(recorded[0].payload).toEqual({ kind: 'unit-test', course: 'zh-test', unit: 'hello', score: 5, total: 5, passed: true, early: true });
		expect(vi.mocked(loadGrammarItems).mock.calls[0][0]).toEqual(['g:shi']);
		expect(screen.getByText(/Everything before this point is done now/)).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'What to review' })).toBeNull();
	});

	it('a failed test shows what to review, keeps progress and can be retried', async () => {
		vi.mocked(loadGrammarItems).mockResolvedValue(grammarItems());
		render(LessonPlayer, { props: { route: { view: 'test', course: 'zh-test', unit: 'hello' } }, context: ctx.context });
		await waitFor(() => expect(document.querySelector('.question')).not.toBeNull());
		await answerAll({ right: false });
		await screen.findByRole('heading', { level: 1, name: 'Not passed yet' });
		expect(screen.getByText('0 of 5 right')).toBeTruthy();
		expect(screen.getByText(/You need 80 % to pass/)).toBeTruthy();
		expect(screen.getByText(/Your progress is kept/)).toBeTruthy();
		const review = screen.getByRole('region', { name: 'What to review' });
		const words = within(review.querySelector<HTMLElement>('.words')!);
		expect(words.getByText('你好')).toBeTruthy();
		expect(words.getByText('hello')).toBeTruthy();
		expect(words.getByText('nǐ hǎo')).toBeTruthy();
		// The unit's practice lesson is still locked: the unit is named without a link.
		expect(within(review).getByRole('heading', { name: 'Units to go back to' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'The verb 是' }).getAttribute('href')).toBe('/grammar/g/shi');
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].payload).toMatchObject({ kind: 'unit-test', passed: false, score: 0, total: 5 });
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(document.querySelector('.question')).not.toBeNull());
		await answerAll();
		await screen.findByRole('heading', { level: 1, name: 'Passed' });
		await waitFor(() => expect(recorded).toHaveLength(2));
		expect(recorded[1].payload).toMatchObject({ kind: 'unit-test', passed: true });
	});

	it('placement: a passed exam offers the next one and Start here; a failed first exam places at the start', async () => {
		render(LessonPlayer, { props: { route: { view: 'placement', course: 'zh-test', section: 'level-1' } }, context: ctx.context });
		await screen.findByText(/Placement asks the section exams/);
		await answerAll();
		await screen.findByRole('heading', { level: 1, name: 'Passed' });
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].payload).toMatchObject({ kind: 'section-exam', section: 'level-1', passed: true });
		expect(screen.getByRole('link', { name: 'Next: the Level 2 exam' }).getAttribute('href')).toBe('/courses/play/zh-test/section/level-2/placement');
		await fireEvent.click(screen.getByRole('button', { name: 'Start here' }));
		await waitFor(() => expect(recorded).toHaveLength(2));
		expect(recorded[1].payload).toEqual({ kind: 'placement', course: 'zh-test', section: 'level-2' });
		cleanup();
		recorded = [];
		render(LessonPlayer, { props: { route: { view: 'placement', course: 'zh-test', section: 'level-1' } }, context: ctx.context });
		await waitFor(() => expect(document.querySelector('.question')).not.toBeNull());
		const asked = await answerAll({ right: false });
		await screen.findByRole('heading', { level: 1, name: 'Not passed yet' });
		// Decided early: 3 words, at most 6 questions, and a fail is certain after two wrong answers.
		expect(asked).toBeLessThan(6);
		expect(screen.getByText(/stopped early/)).toBeTruthy();
		expect(screen.getByText('Your place in the course: Start')).toBeTruthy();
		await waitFor(() => expect(recorded).toHaveLength(2));
		expect(recorded.map((e) => e.payload)).toEqual([
			{ kind: 'section-exam', course: 'zh-test', section: 'level-1', score: 0, total: asked, passed: false },
			{ kind: 'placement', course: 'zh-test', section: 'start' }
		]);
		expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
	});
});
