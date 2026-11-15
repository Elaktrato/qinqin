// The core app's own widgets: they exist whatever plugins are enabled.

import ActivityHeatmap from '$lib/components/ActivityHeatmap.svelte';
import { usesHan } from '$lib/languages';
import CharacterMapSummary from './CharacterMapSummary.svelte';
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
	}
];
