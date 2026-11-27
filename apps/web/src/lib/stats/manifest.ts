// Stats as a core feature (#295, lib/features): its widgets, on Stats and Home only while Stats is on. The pages
// are the routes /stats, /stats/week and /stats/characters, which FeatureGate guards in routes/stats/+layout.svelte.
// The components stay in lib/widgets.
import type { FeatureDef } from '$lib/features';
import { t } from '$lib/i18n';
import { hasCharacterMap } from '$lib/languages/profiles';
import ActivityHeatmap from '$lib/activity/ActivityHeatmap.svelte';
import ActivityHome from '$lib/widgets/ActivityHome.svelte';
import CharacterMapSummary from '$lib/widgets/CharacterMapSummary.svelte';
import ReviewsPerDayWidget from '$lib/widgets/ReviewsPerDayWidget.svelte';
import SummaryWidget from '$lib/widgets/SummaryWidget.svelte';

export const statsDef: FeatureDef = {
	widgets: [
		{
			id: 'activity-heatmap',
			get title() {
				return t('widgets.activity.title');
			},
			get description() {
				return t('widgets.activity.description');
			},
			owner: 'stats',
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
			owner: 'stats',
			size: 'normal',
			appliesTo: hasCharacterMap,
			surfaces: ['stats', 'home'],
			component: CharacterMapSummary
		},
		{
			id: 'summary-numbers',
			get title() {
				return t('widgets.summary.title');
			},
			get description() {
				return t('widgets.summary.description');
			},
			owner: 'stats',
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
			owner: 'stats',
			size: 'wide',
			surfaces: ['stats', 'home'],
			component: ReviewsPerDayWidget
		}
	]
};
