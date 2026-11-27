import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));
vi.mock('$lib/goals/loadGoal', () => ({ loadGoalStatus: vi.fn() }));

import type { GoalView } from '$lib/goals/loadGoal';
import { loadGoalStatus } from '$lib/goals/loadGoal';
import { levelProgress, xpFromReviews } from '$lib/studycore/exp';
import { loadStudyHistory } from '$lib/studycore/data';
import type { ReviewEvent } from '$lib/studycore/types';
import FlashcardsWidget from './FlashcardsWidget.svelte';
import { defaultSetup } from './setup/setup';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const NO_GOAL: GoalView = {
	row: null,
	newer: false,
	today: {
		day: '2026-11-16',
		status: 'none',
		metric: null,
		target: null,
		amount: 0,
		fraction: 0,
		unavailable: false
	},
	streak: null,
	sources: [],
	limitsNew: 20,
	activityError: null
};

const WITH_GOAL: GoalView = {
	row: {
		version: 1,
		showStreak: true,
		history: [{ from: '2026-11-01', metric: 'activity:review', target: 50 }]
	},
	newer: false,
	today: {
		day: '2026-11-16',
		status: 'open',
		metric: 'activity:review',
		target: 50,
		amount: 32,
		fraction: 0.64,
		unavailable: false
	},
	streak: { current: 4, todayMet: false, capped: false },
	sources: [
		{
			type: 'review',
			feature: 'flashcards',
			unit: 'count'
		}
	],
	limitsNew: 20,
	activityError: null
};

const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ').trim();

beforeEach(() => {
	ctx.session.workspaces.set({ list: [], current: { id: 1, language: 'zh', name: 'zh' } as never });
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function ready(): Promise<HTMLElement> {
	const { container } = render(FlashcardsWidget, { context: ctx.context });
	await screen.findByText(/days streak/);
	return container;
}

describe('FlashcardsWidget goal ring', () => {
	it('renders exactly as before without a goal', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(NO_GOAL);
		const container = await ready();
		await new Promise((r) => setTimeout(r, 0));
		expect(text(container)).toBe(
			'Flashcards Study Nothing due today · Level 1 · 0 / 100 XP 🔥 0 days streak · study today to start one'
		);
		expect(screen.queryByRole('progressbar', { name: 'Daily goal' })).toBeNull();
	});

	it('above level 1 the XP line shows the XP into the level, not the cumulative total', async () => {
		// Twenty vocab reviews at grade 3, one on each of twenty learner days:
		// 20 × (10 base + 5 grade) + 20 × 10 daily bonus = 500 XP, which is
		// level 3 with 200 XP into a 300-XP level.
		const reviews: ReviewEvent[] = Array.from({ length: 20 }, (_, i) => ({
			id: `level-${i}`,
			workspaceId: 1,
			device: 'test',
			ts: new Date(Date.UTC(2026, 9, 30 + i, 12)).toISOString(),
			type: 'review',
			payload: { cardId: `c${i}`, mode: 'vocab', grade: 3 }
		}));
		vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews, merged: 0 });
		vi.mocked(loadGoalStatus).mockResolvedValue(NO_GOAL);
		const total = xpFromReviews(reviews, ctx.session.zone.day().dayOf);
		const progress = levelProgress(total);
		expect(progress).toEqual({ level: 3, xpInto: 200, xpForNext: 300 });

		const container = await ready();
		const bar = screen.getByRole('progressbar', { name: 'Progress to the next level' });
		expect(bar.getAttribute('aria-valuenow')).toBe('200');
		expect(bar.getAttribute('aria-valuemax')).toBe('300');
		expect(text(container)).toContain('Level 3 · 200 / 300 XP');
		expect(text(container)).not.toContain('500 / 300');
	});

	it('shows the small ring and the goal streak beside the review streak', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(WITH_GOAL);
		await ready();
		const ring = await screen.findByRole('progressbar', { name: 'Daily goal' });
		expect(ring.getAttribute('aria-valuetext')).toBe('32 of 50 flashcard reviews today');
		expect(screen.getByText('32/50')).toBeTruthy();
		expect(screen.getByText('Goal streak: 4 days')).toBeTruthy();
		expect(loadGoalStatus).toHaveBeenCalledWith(expect.anything(), 1, { force: false });
	});

	it('says "Goal reached" next to the small ring when met', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue({
			...WITH_GOAL,
			today: { ...WITH_GOAL.today, status: 'met', amount: 50, fraction: 1 }
		});
		await ready();
		await screen.findByRole('progressbar', { name: 'Daily goal' });
		expect(screen.getByText('Goal reached')).toBeTruthy();
	});

	it('has no goal streak line when the streak is hidden', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue({ ...WITH_GOAL, streak: null });
		await ready();
		await screen.findByRole('progressbar', { name: 'Daily goal' });
		expect(screen.queryByText(/Goal streak/)).toBeNull();
	});

	it('leaves the ring out when the activity request failed (offline)', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue({
			...WITH_GOAL,
			activityError: 'offline',
			today: { ...WITH_GOAL.today, status: 'none', amount: 0, fraction: 0, unavailable: true },
			streak: null
		});
		await ready();
		await waitFor(() => expect(loadGoalStatus).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByText("This goal's activity is no longer counted")).toBeNull();
		expect(screen.queryByRole('progressbar', { name: 'Daily goal' })).toBeNull();
	});

	it('keeps the widget when the goal fails to load', async () => {
		vi.mocked(loadGoalStatus).mockRejectedValue(new Error('offline'));
		const container = await ready();
		await waitFor(() => expect(loadGoalStatus).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole('progressbar', { name: 'Daily goal' })).toBeNull();
		expect(screen.queryByText(/offline/)).toBeNull();
		expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
		expect(text(container)).toContain('Level 1');
	});
});

describe('FlashcardsWidget and the saved study setup', () => {
	it('counts the kinds of the saved setup: a tone card counts only when the setup studies tone', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(NO_GOAL);
		const tone = { id: 'c-tone-5', kind: 'tone', entryId: 5, written: '好', entryKind: null, sentenceId: null, skipKinds: [], deckIds: ['general'], createdAt: '2026-01-01T00:00:00Z', extra: {} };
		vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [tone], reviews: [], merged: 0 } as never);
		const container = await ready();
		await waitFor(() => expect(text(container)).toContain('Nothing due today'));
		cleanup();
		ctx.session.setups.update(1, { ...defaultSetup(), cardTypes: ['vocab', 'tone'] }).catch(() => undefined);
		const again = await ready();
		await waitFor(() => expect(text(again)).toMatch(/1 new left today/));
	});
});

describe('FlashcardsWidget Study', () => {
	it('opens the study modal instead of following the link', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(NO_GOAL);
		await ready();
		const study = screen.getByRole('link', { name: 'Study' });
		expect(study.getAttribute('href')).toBe('/study');
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		study.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(ctx.session.studyModal.open).toBe(true);
	});
});
