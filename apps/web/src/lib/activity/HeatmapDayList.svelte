<script lang="ts">
	import { t } from '$lib/i18n';
	import { listedCells, type HeatCell } from './cells';

	// The accessible form of every heatmap layout: one item per day with
	// activity, a vacation or a flower stage (the tiles are decorative).
	let { cells }: { cells: readonly HeatCell[] } = $props();
</script>

<ul class="visually-hidden" aria-label={t('stats.activity.daily')}>
	{#each listedCells(cells) as cell (cell.day)}
		<li>{cell.label}</li>
	{/each}
</ul>
