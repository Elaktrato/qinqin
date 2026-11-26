// The chart view's model: the items of a system by group, each with how well it is known.

import { isDue, isKnown, type ItemState } from './progress';
import type { ScriptItem, ScriptSystem } from './types';

export type Mastery = 'unseen' | 'learning' | 'known';

export interface ChartCell {
	item: ScriptItem;
	mastery: Mastery;
	due: boolean;
}

export interface ChartGroup {
	id: string;
	cells: ChartCell[];
}

export function masteryOf(state: ItemState | undefined): Mastery {
	if (state === undefined) return 'unseen';
	return isKnown(state) ? 'known' : 'learning';
}

/** chartGroups: the system's groups in order (an empty one is left out), their cells in chart order. */
export function chartGroups(system: ScriptSystem, map: ReadonlyMap<string, ItemState>, now: number): ChartGroup[] {
	return system.groups
		.map((id) => ({
			id,
			cells: system.items
				.filter((item) => item.group === id)
				.map((item) => ({ item, mastery: masteryOf(map.get(item.id)), due: isDue(map.get(item.id), now) }))
		}))
		.filter((g) => g.cells.length > 0);
}
