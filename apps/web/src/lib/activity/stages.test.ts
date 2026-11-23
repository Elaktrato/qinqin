import { describe, expect, it } from 'vitest';
import type { ActivityCell } from '../api/stats';
import { parseGoalsRow, type GoalsRow } from '../goals/goals';
import type { ReviewEvent } from '../study/types';
import { studyDay } from '../time/studyDay';
import { stageAmounts, stagesFor } from './stages';
import * as build from '$lib/testing/study';

const UTC = studyDay([]);

function review(id: string, ts: string, cardId: string): ReviewEvent {
	return build.review({ id, ts, cardId, workspaceId: 3 });
}

function row(history: unknown[]): GoalsRow {
	return parseGoalsRow({ version: 1, showStreak: true, history }) as GoalsRow;
}

const units = (type: string) => (type === 'review' ? 'count' : type === 'read' ? 'seconds' : null);

describe('stagesFor', () => {
	it('gives each day of the window its stage, null before the goal, resting on vacation', () => {
		// 2026-11-10 (Tue) .. 2026-11-16 (Mon); the goal starts on the 12th.
		const goals = row([{ from: '2026-11-12', metric: 'activity:review', target: 30 }]);
		const cells: ActivityCell[] = [
			{ day: '2026-11-11', workspace: 3, type: 'review', points: 40, raw: 40 },
			{ day: '2026-11-12', workspace: 3, type: 'review', points: 9, raw: 9 },
			{ day: '2026-11-13', workspace: 3, type: 'review', points: 10, raw: 10 },
			{ day: '2026-11-13', workspace: 4, type: 'review', points: 50, raw: 50 },
			{ day: '2026-11-14', workspace: 3, type: 'review', points: 40, raw: 40 },
			{ day: '2026-11-16', workspace: 3, type: 'review', points: 21, raw: 21 },
			{ day: '2026-11-15', workspace: 9, type: 'review', points: 99, raw: 99 }
		];
		const stages = stagesFor({
			row: goals,
			from: '2026-11-10',
			to: '2026-11-16',
			today: '2026-11-16',
			amountsOf: stageAmounts(cells, 3, [], UTC.dayOf),
			vacation: [{ start: '2026-11-15', end: '2026-11-15' }],
			unitOf: units
		});
		expect([...stages.keys()]).toEqual([
			'2026-11-10',
			'2026-11-11',
			'2026-11-12',
			'2026-11-13',
			'2026-11-14',
			'2026-11-15',
			'2026-11-16'
		]);
		expect(stages.get('2026-11-10')).toBeNull();
		expect(stages.get('2026-11-11')).toBeNull();
		expect(stages.get('2026-11-12')).toMatchObject({ stage: 'sprout', amount: 9, target: 30, status: 'missed' });
		// Another workspace's 50 reviews on the 13th do not count.
		expect(stages.get('2026-11-13')).toMatchObject({ stage: 'bud', amount: 10, target: 30 });
		expect(stages.get('2026-11-14')).toMatchObject({ stage: 'bloom', amount: 40, status: 'met' });
		expect(stages.get('2026-11-15')).toMatchObject({ stage: 'resting', status: 'vacation' });
		expect(stages.get('2026-11-16')).toMatchObject({
			stage: 'opening',
			amount: 21,
			target: 30,
			metric: 'activity:review',
			status: 'open'
		});
	});

	it('counts flashcards:new goals from the reviews', () => {
		const goals = row([{ from: '2026-11-01', metric: 'flashcards:new', target: 3 }]);
		const reviews = [
			review('a', '2026-11-15T10:00:00Z', 'c1'),
			review('b', '2026-11-15T10:01:00Z', 'c2'),
			review('c', '2026-11-16T10:00:00Z', 'c1'),
			review('d', '2026-11-16T10:00:00Z', 'c3'),
			review('e', '2026-11-16T10:01:00Z', 'c4'),
			review('f', '2026-11-16T10:02:00Z', 'c5')
		];
		const stages = stagesFor({
			row: goals,
			from: '2026-11-14',
			to: '2026-11-16',
			today: '2026-11-16',
			amountsOf: stageAmounts([], 3, reviews, UTC.dayOf),
			vacation: [],
			unitOf: units
		});
		expect(stages.get('2026-11-14')).toMatchObject({ stage: 'soil', amount: 0 });
		expect(stages.get('2026-11-15')).toMatchObject({ stage: 'opening', amount: 2 });
		expect(stages.get('2026-11-16')).toMatchObject({ stage: 'bloom', amount: 3 });
	});

	it('is empty without a goal row and never evaluates days after today', () => {
		const none = stagesFor({
			row: null,
			from: '2026-11-14',
			to: '2026-11-16',
			today: '2026-11-16',
			amountsOf: stageAmounts([], 3, [], UTC.dayOf),
			vacation: [],
			unitOf: units
		});
		expect(none.size).toBe(0);
		const goals = row([{ from: '2026-11-01', metric: 'activity:review', target: 3 }]);
		const capped = stagesFor({
			row: goals,
			from: '2026-11-15',
			to: '2026-11-20',
			today: '2026-11-16',
			amountsOf: stageAmounts([], 3, [], UTC.dayOf),
			vacation: [],
			unitOf: units
		});
		expect([...capped.keys()]).toEqual(['2026-11-15', '2026-11-16']);
	});
});
