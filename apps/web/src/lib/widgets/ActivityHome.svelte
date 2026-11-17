<script lang="ts">
	import { onMount } from 'svelte';
	import ActivityHeatmap from '$lib/components/ActivityHeatmap.svelte';
	import { DEFAULT_HEATMAP_LAYOUT, loadWidgetOptions, type HeatmapLayout } from './options';

	// The activity heatmap on the home page: the layout the person chose in
	// Settings → Home (the `widget-options` row). The garden grid shows while
	// the row loads and when it cannot be read. Stats keeps the garden.
	let layout = $state<HeatmapLayout>(DEFAULT_HEATMAP_LAYOUT);

	onMount(() => {
		loadWidgetOptions().then(
			(options) => (layout = options.heatmapLayout),
			(err) => console.warn('widget options not loaded', err)
		);
	});
</script>

<ActivityHeatmap {layout} />
