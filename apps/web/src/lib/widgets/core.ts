// The core app's own widgets: they exist whatever features are switched on.
// The statistics widgets (heatmap, character map, summary, reviews per day)
// belong to the Stats feature since #295 (lib/stats/manifest.ts).

import { t } from '$lib/i18n';
import DailyGoalWidget from './DailyGoalWidget.svelte';
import WeeklySummaryWidget from './WeeklySummaryWidget.svelte';
import type { WidgetDef } from './types';

export const coreWidgets: WidgetDef[] = [
	{
		id: 'daily-goal',
		get title() {
			return t('widgets.goal.title');
		},
		get description() {
			return t('widgets.goal.description');
		},
		owner: 'core',
		size: 'normal',
		// Home only: Stats stays as it was for learners without a goal.
		surfaces: ['home'],
		component: DailyGoalWidget
	},
	{
		id: 'weekly-summary',
		get title() {
			return t('widgets.week.title');
		},
		get description() {
			return t('widgets.week.description');
		},
		owner: 'core',
		size: 'normal',
		// Home only, as the daily goal: Stats has the Week tab.
		surfaces: ['home'],
		component: WeeklySummaryWidget
	}
];
