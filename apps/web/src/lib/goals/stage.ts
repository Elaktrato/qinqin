// The flower stage of a goal day (design §9 "Home"): derived, never stored.
// Until the drawings exist (#107) clients show it as text only. Pure.
// Rule and fixture: docs/contracts/goals/README.md, flower-stages.json.

import type { GoalDay } from './progress';

export const FLOWER_STAGES = ['soil', 'sprout', 'bud', 'opening', 'bloom', 'resting'] as const;
export type FlowerStage = (typeof FLOWER_STAGES)[number];

/**
 * flowerStage: no goal (or an unavailable one) → null; vacation → resting
 * (before the amount); met → bloom; otherwise by the fraction of the raw
 * amount (seconds for time goals): 0 → soil, < 1/3 → sprout, ≥ 1/3 → bud,
 * ≥ 2/3 → opening.
 */
export function flowerStage(day: GoalDay): FlowerStage | null {
	if (day.status === 'none' || day.unavailable) return null;
	if (day.status === 'vacation') return 'resting';
	if (day.status === 'met') return 'bloom';
	const fraction = day.fraction;
	if (!(fraction > 0)) return 'soil';
	if (fraction >= 2 / 3) return 'opening';
	if (fraction >= 1 / 3) return 'bud';
	return 'sprout';
}
