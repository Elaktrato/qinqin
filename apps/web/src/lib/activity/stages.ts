// The flower stage of each heatmap day (design §9 "Home"): the daily goal's
// day status (goals/progress.ts) turned into a stage (goals/stage.ts). Pure.
// Stages exist only for one workspace with a goal row; until the drawings
// exist (#107) the heatmap shows them as text.

import type { ActivityCell } from '../api/stats';
import { activityAmounts, amountsOf, flashcardAmounts, type DayAmounts } from '../goals/amounts';
import type { GoalMetric, GoalsRow } from '../goals/goals';
import { goalDays, type GoalStatus, type UnitOf } from '../goals/progress';
import { flowerStage, type FlowerStage } from '../goals/stage';
import type { ReviewEvent } from '$lib/studycore/types';
import type { Run } from '$lib/studycore/vacation';

export interface DayStage {
	stage: FlowerStage;
	status: GoalStatus;
	metric: GoalMetric;
	/** In display units: a count, or whole minutes. */
	amount: number;
	target: number;
}

/** stageAmounts: one workspace's activity cells plus its reviews, per learner day. */
export function stageAmounts(
	cells: readonly ActivityCell[],
	workspaceId: number,
	reviews: readonly ReviewEvent[],
	dayOf: (ms: number) => string
): (day: string) => DayAmounts {
	return amountsOf(flashcardAmounts(reviews, dayOf), activityAmounts(cells, workspaceId));
}

/**
 * stagesFor: every learner day from..min(to, today), its stage or null (no
 * goal, an unavailable goal). Empty without a goal row.
 */
export function stagesFor(input: {
	row: GoalsRow | null;
	from: string;
	to: string;
	today: string;
	amountsOf: (day: string) => DayAmounts;
	vacation: readonly Run[];
	unitOf: UnitOf;
}): Map<string, DayStage | null> {
	const out = new Map<string, DayStage | null>();
	if (input.row === null) return out;
	const to = input.to < input.today ? input.to : input.today;
	for (const day of goalDays(input.row, input.from, to, input.today, input.amountsOf, input.vacation, input.unitOf)) {
		const stage = flowerStage(day);
		out.set(
			day.day,
			stage === null || day.metric === null || day.target === null
				? null
				: { stage, status: day.status, metric: day.metric, amount: day.amount, target: day.target }
		);
	}
	return out;
}
