import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('../lessonData', () => ({ loadDisplayLesson: vi.fn() }));
vi.mock('./review', async (importOriginal) => ({
	...(await importOriginal<typeof import('./review')>()),
	loadReview: vi.fn(),
	recordReview: vi.fn(async (_s: unknown, workspaceId: number, packId: string, lessonId: string, score: number, total: number) => ({
		id: 'r',
		workspaceId,
		ts: '2026-11-27T10:00:00Z',
		at: 0,
		point: `${packId}:${lessonId}`,
		packId,
		lessonId,
		mode: 'review',
		score,
		total
	}))
}));

import { loadDisplayLesson } from '../lessonData';
import { loadReview, recordReview } from './review';
import ReviewRound from './ReviewRound.svelte';

let ctx: TestContext = testContext();
const ws = { id: 1, language: 'ja', name: '', settings: {}, updatedAt: '' } as never;

function state(point: string, reviews: number) {
	return { point, learnedAt: '2026-11-20T08:00:00Z', reviews, lastReviewed: null, firstReviewAt: null, due: '2026-11-20T08:10:00Z', stability: 2, difficulty: 2, state: 1 };
}

function data(points: string[]) {
	return {
		packs: [],
		progress: new Map(),
		states: new Map(points.map((p) => [p, state(p, 0)])),
		titles: new Map(points.map((p) => [p, `Lesson ${p}`])),
		round: { items: points.map((point) => ({ point, why: 'new' })), due: 0, new: points.length, newToday: 0 }
	};
}

// One example: a cloze for the first review (a word order needs segmentation, not here).
const display = {
	textLang: 'ja',
	view: { pack: { language: 'ja' }, prev: '', next: '' },
	lesson: {
		id: 'l1',
		title: 'The は particle',
		summary: '',
		pattern: [],
		body: [],
		examples: [{ id: 'e1', text: '私は学生です。', focus: '学生', reading: 'わたしはがくせいです', translation: 'I am a student.', distractors: ['先生', '学校'], noOrder: true }]
	}
};

beforeEach(() => {
	ctx = testContext();
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.mocked(loadDisplayLesson).mockResolvedValue(display as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('the grammar review round (#181)', () => {
	it('asks each point its exercises, records the run as a review and ends with a summary', async () => {
		vi.mocked(loadReview).mockResolvedValue(data(['basics:l1']) as never);
		render(ReviewRound, { context: ctx.context });
		expect(await screen.findByRole('heading', { name: 'Lesson basics:l1' })).toBeTruthy();
		expect(screen.getByText(/Point 1 of 1/)).toBeTruthy();
		expect(screen.getByText(/first review/)).toBeTruthy();
		await fireEvent.click(await screen.findByRole('button', { name: '学生' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
		expect(await screen.findByText('1 grammar point reviewed')).toBeTruthy();
		expect(recordReview).toHaveBeenCalledWith(expect.anything(), 1, 'basics', 'l1', 1, 1);
		expect(screen.getByRole('link', { name: 'Done' }).getAttribute('href')).toBe('/grammar');
	});

	it('passes over a point whose lesson is gone, and Skip records nothing', async () => {
		vi.mocked(loadReview).mockResolvedValue(data(['gone:x', 'basics:l1', 'basics:l2']) as never);
		vi.mocked(loadDisplayLesson).mockImplementation(async (pack) => (pack === 'gone' ? null : (display as never)));
		render(ReviewRound, { context: ctx.context });
		expect(await screen.findByRole('heading', { name: 'Lesson basics:l1' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Skip this point' }));
		expect(await screen.findByRole('heading', { name: 'Lesson basics:l2' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'End review' }));
		expect(await screen.findByText('0 grammar points reviewed')).toBeTruthy();
		expect(recordReview).not.toHaveBeenCalled();
	});

	it('on its own page an empty round says so and when the next review is', async () => {
		const d = data([]);
		d.states.set('basics:l1', { ...state('basics:l1', 1), due: '2099-01-05T08:00:00Z' });
		d.titles.set('basics:l1', 'Lesson');
		vi.mocked(loadReview).mockResolvedValue(d as never);
		render(ReviewRound, { context: ctx.context });
		expect(await screen.findByText('Nothing to review right now.')).toBeTruthy();
		expect(screen.getByText(/^Next review: /)).toBeTruthy();
	});

	it('inside a session it hands the runs over instead of a summary, at once when nothing is due', async () => {
		vi.mocked(loadReview).mockResolvedValue(data([]) as never);
		const onDone = vi.fn();
		render(ReviewRound, { props: { embedded: true, onDone }, context: ctx.context });
		await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith([]));
		expect(screen.queryByRole('link', { name: 'Done' })).toBeNull();
	});

	it('inside a session a reviewed point is handed over as its run', async () => {
		vi.mocked(loadReview).mockResolvedValue(data(['basics:l1']) as never);
		const onDone = vi.fn();
		render(ReviewRound, { props: { embedded: true, onDone }, context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: '学生' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
		await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		expect(onDone.mock.calls[0][0]).toMatchObject([{ point: 'basics:l1', mode: 'review', score: 1, total: 1 }]);
	});
});
