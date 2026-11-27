<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import ActivityHeatmap from '$lib/activity/ActivityHeatmap.svelte';
	import { DEFAULT_HEATMAP_LAYOUT, type HeatmapLayout } from './options';
	import { heldOptions, refreshOptions } from './homeData';
	import WidgetCard from './WidgetCard.svelte';
	import { useSession } from '$lib/context/context';

	// The activity heatmap on the home page: the layout the person chose in
	// Settings → Home (the `widget-options` row). The heatmap mounts only once
	// the row has settled, so a month or week user never gets the 13-week
	// request and a flash of the garden first (#100 review); the garden
	// shows when the row cannot be read. Stats keeps the garden. Options this
	// session holds show at once and are refreshed behind them (#290).
	const session = useSession();
	const held = heldOptions(session);
	let layout = $state<HeatmapLayout>(held?.heatmapLayout ?? DEFAULT_HEATMAP_LAYOUT);
	let settled = $state(held !== null);

	onMount(() => {
		refreshOptions(session)
			.then(
				(options) => (layout = options.heatmapLayout),
				(err) => console.warn('widget options not loaded', err)
			)
			.finally(() => (settled = true));
	});
</script>

{#if settled}
	<ActivityHeatmap {layout} />
{:else}
	<WidgetCard
		title={t('widgets.activity.title')}
		headingId="activity-heading"
		status="loading"
		loadingText={t('stats.activity.loading')}
	/>
{/if}
