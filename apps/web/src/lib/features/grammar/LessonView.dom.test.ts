import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('./lessonData', () => ({ loadDisplayLesson: vi.fn() }));
vi.mock('$lib/features/reader/useLookup.svelte', () => ({
	LookupController: class {
		attach(): () => void {
			return () => {};
		}
		close(): void {}
		listen(): () => void {
			return () => {};
		}
	}
}));
vi.mock('$lib/features/reader/PopupStackView.svelte', async () => ({
	default: (await import('./EmptyStub.test.svelte')).default
}));

import { loadDisplayLesson } from './lessonData';
import { primaryActions } from '$lib/ui/testing/primary';
import LessonView from './LessonView.svelte';

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
			pattern: ['A は B'],
			body: ['Text'],
			examples: [
				{
					id: 'e1',
					text: '私は学生です。',
					focus: '学生',
					reading: '',
					translation: 'I am a student.',
					distractors: []
				}
			]
		}
	} as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	ctx.session.workspaces.set({ list: [], current: null });
});

describe('a grammar lesson in the lighter look (#106)', () => {
	it('shows the target in the reading accent and Practice as the one primary', async () => {
		render(LessonView, { props: { pack: 'basics', lessonId: 'l1' }, context: ctx.context });
		expect(await screen.findByRole('heading', { name: 'The は particle' })).toBeTruthy();
		expect(document.querySelector('.target')?.textContent).toBe('学生');
		const practice = screen.getByRole('link', { name: 'Practice' });
		expect(primaryActions(document.body)).toEqual([practice]);
		expect(practice.className).toContain('primary');
	});
});
