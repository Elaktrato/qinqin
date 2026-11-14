// The core app's own widgets: they exist whatever plugins are enabled.

import ActivityHeatmap from '$lib/components/ActivityHeatmap.svelte';
import type { WidgetDef } from './types';

export const coreWidgets: WidgetDef[] = [
	{
		id: 'activity-heatmap',
		title: 'Activity',
		description: 'Learning activity per day over the last 13 weeks.',
		owner: 'core',
		size: 'wide',
		surfaces: ['stats', 'home'],
		component: ActivityHeatmap
	}
];
