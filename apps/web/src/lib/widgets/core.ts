// The core app's own widgets: they exist whatever plugins are enabled.

import ActivityHeatmap from '$lib/components/ActivityHeatmap.svelte';
import { usesHan } from '$lib/languages';
import CharacterMapSummary from './CharacterMapSummary.svelte';
import DailyGoalWidget from './DailyGoalWidget.svelte';
import type { WidgetDef } from './types';

export const coreWidgets: WidgetDef[] = [
	{
		id: 'activity-heatmap',
		title: 'Activity',
		description: 'Learning activity per day over the last 13 weeks, per workspace or across all.',
		owner: 'core',
		size: 'wide',
		surfaces: ['stats', 'home'],
		component: ActivityHeatmap
	},
	{
		id: 'character-map-summary',
		title: 'Characters',
		description: 'Characters learned, the stage bar and a link to the full character map.',
		owner: 'core',
		size: 'normal',
		appliesTo: usesHan,
		surfaces: ['stats', 'home'],
		component: CharacterMapSummary
	},
	{
		id: 'daily-goal',
		title: 'Daily goal',
		description: 'Today’s progress towards your daily goal and the goal streak.',
		owner: 'core',
		size: 'normal',
		// Home only: Stats stays as it was for learners without a goal.
		surfaces: ['home'],
		component: DailyGoalWidget
	}
];
