import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn() }));
vi.mock('$lib/goals/loadGoal', () => ({ loadGoalStatus: vi.fn() }));

import type { GoalView } from '$lib/goals/loadGoal';
import { loadGoalStatus } from '$lib/goals/loadGoal';
import { loadStudyHistory } from '$lib/study/history';
import { workspaces } from '$lib/workspaces';
import FlashcardsWidget from './FlashcardsWidget.svelte';

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
	limitsNew: 20
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
			plugin: 'qinqin-flashcards',
			label: 'Flashcard reviews',
			unit: 'count',
			describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' }
		}
	],
	limitsNew: 20
};

const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ').trim();

beforeEach(() => {
	workspaces.set({ list: [], current: { id: 1, language: 'zh', name: 'zh' } as never });
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function ready(): Promise<HTMLElement> {
	const { container } = render(FlashcardsWidget);
	await screen.findByText(/days streak/);
	return container;
}

describe('FlashcardsWidget goal ring', () => {
	it('renders exactly as before without a goal', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(NO_GOAL);
		const container = await ready();
		await new Promise((r) => setTimeout(r, 0));
		expect(text(container)).toBe(
			'Flashcards Study Nothing due today · Level 1 · 0 XP 🔥 0 days streak · study today to start one'
		);
		expect(screen.queryByRole('progressbar', { name: 'Daily goal' })).toBeNull();
	});

	it('shows the small ring and the goal streak beside the review streak', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(WITH_GOAL);
		await ready();
		const ring = await screen.findByRole('progressbar', { name: 'Daily goal' });
		expect(ring.getAttribute('aria-valuetext')).toBe('32 of 50 flashcard reviews today');
		expect(screen.getByText('32/50')).toBeTruthy();
		expect(screen.getByText('Goal streak: 4 days')).toBeTruthy();
		expect(loadGoalStatus).toHaveBeenCalledWith(1, { force: false });
	});

	it('has no goal streak line when the streak is hidden', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue({ ...WITH_GOAL, streak: null });
		await ready();
		await screen.findByRole('progressbar', { name: 'Daily goal' });
		expect(screen.queryByText(/Goal streak/)).toBeNull();
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
