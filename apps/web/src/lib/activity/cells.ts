// One tile of the heatmap, whatever the layout (garden, month, week): the
// tint level, the marks and the words. Built by ActivityHeatmap.svelte,
// drawn by Heatmap{Garden,Month,Week}.svelte.

import type { DayStage } from './stages';

export interface HeatCell {
	day: string;
	/** The activity tint 0..4 (levelFor of the day's points). */
	level: 0 | 1 | 2 | 3 | 4;
	vacation: boolean;
	today: boolean;
	/** After today: an empty outline, never listed. */
	future: boolean;
	/** The tooltip and the screen-reader text of the day. */
	label: string;
	/** The flower stage (text only until the drawings exist); null without a goal. */
	stage: DayStage | null;
	/** Under a large tile: "21/50" with a goal, else the points. */
	amountText: string;
}

/** listedCells: the days the screen-reader list names (activity, vacation or a stage). */
export function listedCells(cells: readonly HeatCell[]): HeatCell[] {
	return cells.filter((c) => !c.future && (c.level > 0 || c.vacation || c.stage !== null));
}
