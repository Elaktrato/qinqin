import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('./lessonData', () => ({ loadDisplayLesson: vi.fn() }));
vi.mock('./progress', () => ({ recordRun: vi.fn(async () => ({ best: 1, total: 1 })) }));
vi.mock('./exercises', async (importOriginal) => ({
	...(await importOriginal<typeof import('./exercises')>()),
	buildExercises: () => [
		{
			kind: 'cloze',
			example: {
				id: 'e1',
				text: '私は学生です。',
				focus: '学生',
				reading: '',
				translation: 'I am a student.',
				distractors: ['先生', '学校']
			},
			choices: ['学生', '先生', '学校']
		}
	]
}));

import { loadDisplayLesson } from './lessonData';
import { primaryActions } from '$lib/ui/testing/primary';
import PracticeRun from './PracticeRun.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const ws = { id: 1, language: 'ja', name: '', settings: {}, updatedAt: '' } as never;

beforeEach(() => {
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.mocked(loadDisplayLesson).mockResolvedValue({
		textLang: 'ja',
		view: {
			pack: { language: 'ja', name: 'Basic grammar', license: 'CC BY-SA 4.0', attribution: 'Someone' },
			prev: null,
			next: null
		},
		lesson: {
			id: 'l1',
			title: 'The は particle',
			summary: 'Topic marker',
			pattern: [],
			body: [],
			examples: []
		}
	} as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	ctx.session.workspaces.set({ list: [], current: null });
});

describe('grammar practice in the lighter look (#106)', () => {
	it('has no primary before the answer, then Next is the one primary, then Retry', async () => {
		render(PracticeRun, { props: { pack: 'basics', lessonId: 'l1' }, context: ctx.context });
		await screen.findByRole('heading', { name: 'The は particle' });
		expect(primaryActions(document.body)).toHaveLength(0);
		await fireEvent.click(screen.getByRole('button', { name: '学生' }));
		const next = await screen.findByRole('button', { name: 'Finish' });
		expect(primaryActions(document.body)).toEqual([next]);
		await fireEvent.click(next);
		const retry = await screen.findByRole('button', { name: 'Retry' });
		expect(primaryActions(document.body)).toEqual([retry]);
		expect(screen.getByRole('status').textContent).toContain('Score: 1/1');
	});
});
