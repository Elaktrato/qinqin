import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../study/history', () => ({ loadStudyHistory: vi.fn() }));
vi.mock('../api/stats', () => ({ fetchActivity: vi.fn() }));
vi.mock('../time/zone', async () => {
	const { studyDay } = await import('../time/studyDay');
	return { currentStudyDay: () => studyDay([]) };
});

import { fetchActivity, type ActivityResponse } from '../api/stats';
import { loadStudyHistory } from '../study/history';
import { setOutboxUser } from '../study/outboxUser';
import type { StudyHistory } from '../study/types';
import { loadGoalStatus } from './loadGoal';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const REVIEW = {
	type: 'review',
	plugin: 'qinqin-flashcards',
	label: 'Flashcard reviews',
	unit: 'count' as const,
	describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' }
};

function history(extra: Partial<StudyHistory>): StudyHistory {
	return { decks: [], cards: [], reviews: [], merged: 0, ...extra };
}

function activity(cells: ActivityResponse['cells']): ActivityResponse {
	return { from: '', to: '', timeZone: 'UTC', sources: [REVIEW], cells };
}

const goalRow = (showStreak = true) => ({
	version: 1 as const,
	showStreak,
	history: [{ from: '2026-11-01', metric: 'activity:review' as const, target: 5 }]
});

beforeEach(() => {
	vi.mocked(fetchActivity).mockResolvedValue(
		activity([
			{ day: '2026-11-15', workspace: 3, type: 'review', points: 5, raw: 5 },
			{ day: '2026-11-16', workspace: 3, type: 'review', points: 2, raw: 2 },
			{ day: '2026-11-16', workspace: 4, type: 'review', points: 9, raw: 9 }
		])
	);
});
afterEach(() => vi.clearAllMocks());

describe('loadGoalStatus', () => {
	it('shares one load between concurrent calls', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ goals: goalRow() }));
		const [a, b] = await Promise.all([
			loadGoalStatus(3, { now: NOW }),
			loadGoalStatus(3, { now: NOW })
		]);
		expect(a).toBe(b);
		expect(loadStudyHistory).toHaveBeenCalledTimes(1);
		expect(fetchActivity).toHaveBeenCalledTimes(1);
		// Settled: the next call loads again.
		await loadGoalStatus(3, { now: NOW });
		expect(loadStudyHistory).toHaveBeenCalledTimes(2);
	});

	it('does not share a load between users', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ goals: goalRow() }));
		setOutboxUser(1, 'token-one');
		const first = loadGoalStatus(3, { now: NOW });
		setOutboxUser(2, 'token-two');
		const second = loadGoalStatus(3, { now: NOW });
		expect(second).not.toBe(first);
		await Promise.all([first, second]);
		expect(loadStudyHistory).toHaveBeenCalledTimes(2);
		setOutboxUser(null, null);
	});

	it('asks for a year with the streak, for the workspace, and computes today and the streak', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ goals: goalRow() }));
		const view = await loadGoalStatus(3, { now: NOW });
		expect(fetchActivity).toHaveBeenCalledWith('2025-11-16', '2026-11-16', 3);
		expect(view.today.status).toBe('open');
		expect(view.today.amount).toBe(2);
		expect(view.streak).toEqual({ current: 1, todayMet: false, capped: false });
		expect(view.sources).toEqual([REVIEW]);
		expect(view.newer).toBe(false);
		expect(view.activityError).toBeNull();
	});

	it('asks only for today without the streak', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ goals: goalRow(false) }));
		const view = await loadGoalStatus(3, { now: NOW });
		expect(fetchActivity).toHaveBeenCalledWith('2026-11-16', '2026-11-16', 3);
		expect(view.streak).toBeNull();
	});

	it('has no goal and no streak without a row', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({}));
		const view = await loadGoalStatus(3, { now: NOW });
		expect(view.row).toBeNull();
		expect(view.today.status).toBe('none');
		expect(view.streak).toBeNull();
		expect(view.limitsNew).toBe(20);
	});

	it('reports a newer row as no goal', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ goals: 'newer' }));
		const view = await loadGoalStatus(3, { now: NOW });
		expect(view.newer).toBe(true);
		expect(view.row).toBeNull();
		expect(view.today.status).toBe('none');
	});

	it('is vacation on a vacation day of the workspace', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({
				goals: goalRow(),
				vacations: [
					{
						version: 1,
						id: 'V',
						start: '2026-11-16',
						end: null,
						scope: { workspaces: [3] },
						createdDay: '2026-11-10',
						createdAt: '2026-11-10T00:00:00Z'
					}
				]
			})
		);
		const view = await loadGoalStatus(3, { now: NOW });
		expect(view.today.status).toBe('vacation');
		expect(view.streak?.todayMet).toBe(true);
	});

	it('reads the effective workspace new-card limit', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({ goals: goalRow(), limits: { workspace: { new: 7 }, decks: {} } })
		);
		expect((await loadGoalStatus(3, { now: NOW })).limitsNew).toBe(7);
	});

	it('passes force to the history; an activity goal reports a failed activity request', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ goals: goalRow() }));
		vi.mocked(fetchActivity).mockRejectedValue(new Error('offline'));
		const view = await loadGoalStatus(3, { now: NOW, force: true });
		expect(loadStudyHistory).toHaveBeenCalledWith(3, { force: true });
		expect(view.activityError).toBe('offline');
		expect(view.today.unavailable).toBe(true);
		expect(view.today.status).toBe('none');
	});

	const newCards = (from = '2026-11-01') => ({
		version: 1 as const,
		showStreak: true,
		history: [{ from, metric: 'flashcards:new' as const, target: 2 }]
	});
	const review = (n: number, ts: string, cardId: string) => ({
		id: `01JLOADGOAL${String(n).padStart(15, '0')}`,
		workspaceId: 3,
		device: 'web',
		ts,
		type: 'review' as const,
		payload: { cardId, mode: 'vocab' as const, grade: 3 as const }
	});

	it('a flashcards goal needs no activity request (works offline)', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({
				goals: newCards(),
				reviews: [
					review(1, '2026-11-15T10:00:00Z', 'a'),
					review(2, '2026-11-15T10:01:00Z', 'b'),
					review(3, '2026-11-16T10:00:00Z', 'c')
				]
			})
		);
		vi.mocked(fetchActivity).mockRejectedValue(new Error('offline'));
		const view = await loadGoalStatus(3, { now: NOW });
		expect(fetchActivity).not.toHaveBeenCalled();
		expect(view.activityError).toBeNull();
		expect([view.today.status, view.today.amount]).toEqual(['open', 1]);
		expect(view.streak).toEqual({ current: 1, todayMet: false, capped: false });
	});

	it('asks for activity when an activity goal is in effect inside the window', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({
				goals: {
					version: 1,
					showStreak: true,
					history: [
						{ from: '2026-11-01', metric: 'activity:review', target: 5 },
						{ from: '2026-11-10', metric: 'flashcards:new', target: 2 }
					]
				}
			})
		);
		vi.mocked(fetchActivity).mockRejectedValue(new Error('offline'));
		const view = await loadGoalStatus(3, { now: NOW });
		expect(fetchActivity).toHaveBeenCalledWith('2025-11-16', '2026-11-16', 3);
		// Today's flashcards goal is still computed; the activity request failed.
		expect(view.today.status).toBe('open');
		expect(view.today.unavailable).toBe(false);
		expect(view.activityError).toBe('offline');
	});

	it('skips activity when the activity goal ended before the window', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history({
				goals: {
					version: 1,
					showStreak: false,
					history: [
						{ from: '2026-11-01', metric: 'activity:review', target: 5 },
						{ from: '2026-11-10', metric: 'flashcards:new', target: 2 }
					]
				}
			})
		);
		await loadGoalStatus(3, { now: NOW });
		expect(fetchActivity).not.toHaveBeenCalled();
	});
});
