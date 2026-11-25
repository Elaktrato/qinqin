// The core app's own widgets: they exist whatever features are switched on.

import { hasCharacterMap } from '$lib/languages/profiles';
import ActivityHeatmap from '$lib/activity/ActivityHeatmap.svelte';
import { t } from '$lib/i18n';
import ActivityHome from './ActivityHome.svelte';
import CharacterMapSummary from './CharacterMapSummary.svelte';
import DailyGoalWidget from './DailyGoalWidget.svelte';
import ReviewsPerDayWidget from './ReviewsPerDayWidget.svelte';
import SummaryWidget from './SummaryWidget.svelte';
import WeeklySummaryWidget from './WeeklySummaryWidget.svelte';
import type { WidgetDef } from './types';

export const coreWidgets: WidgetDef[] = [
	{
		id: 'activity-heatmap',
		get title() {
			return t('widgets.activity.title');
		},
		get description() {
			return t('widgets.activity.description');
		},
		owner: 'core',
		size: 'wide',
		surfaces: ['stats', 'home'],
		component: ActivityHeatmap,
		// Home shows the layout chosen in Settings → Home; Stats the garden grid.
		homeComponent: ActivityHome
	},
	{
		id: 'character-map-summary',
		get title() {
			return t('widgets.characters.title');
		},
		get description() {
			return t('widgets.characters.description');
		},
		owner: 'core',
		size: 'normal',
		appliesTo: hasCharacterMap,
		surfaces: ['stats', 'home'],
		component: CharacterMapSummary
	},
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
		id: 'summary-numbers',
		get title() {
			return t('widgets.summary.title');
		},
		get description() {
			return t('widgets.summary.description');
		},
		owner: 'core',
		size: 'wide',
		surfaces: ['stats', 'home'],
		component: SummaryWidget
	},
	{
		id: 'reviews-per-day',
		get title() {
			return t('widgets.reviewsPerDay.title');
		},
		get description() {
			return t('widgets.reviewsPerDay.description');
		},
		owner: 'core',
		size: 'wide',
		surfaces: ['stats', 'home'],
		component: ReviewsPerDayWidget
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
