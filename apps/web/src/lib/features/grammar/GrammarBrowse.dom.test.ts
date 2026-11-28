import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []) }));
vi.mock('./review/review', () => ({ loadReview: vi.fn() }));
vi.mock('./browse', () => ({ browseSections: vi.fn() }));

import { browseSections } from './browse';
import { loadReview } from './review/review';
import { primaryActions } from '$lib/ui/testing/primary';
import GrammarBrowse from './GrammarBrowse.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const ws = { id: 1, language: 'ja', name: '', settings: {}, updatedAt: '' } as never;

const nothingLearned = { packs: [], progress: new Map(), states: new Map(), titles: new Map(), round: { items: [], due: 0, new: 0, newToday: 0 } };

function learnedPoint(due: string) {
	return { point: 'basics:l1', learnedAt: '2026-11-20T08:00:00Z', reviews: 1, lastReviewed: '2026-11-22T08:00:00Z', firstReviewAt: 0, due, stability: 1, difficulty: 5, state: 2 };
}

beforeEach(() => {
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.mocked(loadReview).mockResolvedValue(nothingLearned as never);
	vi.mocked(browseSections).mockReturnValue([
		{
			packId: 'basics',
			packName: 'Basic grammar',
			credits: { license: 'CC BY-SA 4.0', attribution: 'Someone' },
			levels: [
				{
					id: 'n5',
					name: 'N5',
					badges: ['HSK 2'],
					lessons: [
						{
							id: 'l1',
							title: 'The は particle',
							summary: 'Topic marker',
							progress: { best: 8, total: 10 }
						}
					]
				}
			]
		}
	] as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	ctx.session.workspaces.set({ list: [], current: null });
});

describe('grammar browse in the lighter look (#106)', () => {
	it('packs are Sections, levels carry Chips, points are rows, and there is no primary action', async () => {
		render(GrammarBrowse, { context: ctx.context });
		expect(await screen.findByRole('heading', { name: 'Basic grammar' })).toBeTruthy();
		expect(screen.getByText('HSK 2')).toBeTruthy();
		expect(screen.getByRole('link', { name: /The は particle/ })).toBeTruthy();
		expect(screen.getByText('8/10')).toBeTruthy();
		expect(primaryActions(document.body)).toHaveLength(0);
	});

	it('shows no review section before a point is learned (#181)', async () => {
		render(GrammarBrowse, { context: ctx.context });
		await screen.findByRole('heading', { name: 'Basic grammar' });
		expect(screen.queryByRole('heading', { name: 'Grammar review' })).toBeNull();
	});

	it('shows how many points are due with Review now as the one primary (#181)', async () => {
		vi.mocked(loadReview).mockResolvedValue({
			...nothingLearned,
			states: new Map([['basics:l1', learnedPoint('2026-11-23T08:00:00Z')]]),
			titles: new Map([['basics:l1', 'The は particle']]),
			round: { items: [{ point: 'basics:l1', why: 'due' }], due: 1, new: 2, newToday: 0 }
		} as never);
		render(GrammarBrowse, { context: ctx.context });
		expect(await screen.findByRole('heading', { name: 'Grammar review' })).toBeTruthy();
		expect(screen.getByText('3 grammar points to review')).toBeTruthy();
		const start = screen.getByRole('link', { name: 'Review now' });
		expect(start.getAttribute('href')).toBe('/grammar/review');
		expect(primaryActions(document.body)).toEqual([start]);
	});

	it('says when the next review is when nothing is due, and shows each lesson row its status (#181)', async () => {
		vi.mocked(loadReview).mockResolvedValue({
			...nothingLearned,
			states: new Map([['basics:l1', learnedPoint('2099-01-05T08:00:00Z')]]),
			titles: new Map([['basics:l1', 'The は particle']])
		} as never);
		vi.mocked(browseSections).mockReturnValue([
			{
				packId: 'basics',
				packName: 'Basic grammar',
				credits: { license: 'CC BY-SA 4.0', attribution: 'Someone' },
				levels: [
					{
						id: 'n5',
						name: 'N5',
						badges: [],
						lessons: [
							{
								id: 'l1',
								title: 'The は particle',
								summary: 'Topic marker',
								progress: { best: 8, total: 10 },
								review: { due: true, dueAt: '2026-11-23T08:00:00Z', lastReviewed: '2026-11-22T08:00:00Z', learnedAt: '2026-11-20T08:00:00Z' }
							}
						]
					}
				]
			}
		] as never);
		render(GrammarBrowse, { context: ctx.context });
		expect(await screen.findByText(/^Next review: /)).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Review now' })).toBeNull();
		expect(screen.getByText(/Due for review · last reviewed/)).toBeTruthy();
	});
});
