<script lang="ts">
	import type { HeatCell } from './cells';
	import HeatmapDayList from './HeatmapDayList.svelte';

	// Garden grid: the last 13 weeks, one small tile per day in columns of
	// seven, tinted by the day's activity (design §6 heatmap tint). The tiles
	// are decorative (tooltips via title); the list carries the meaning.
	let { cells }: { cells: readonly HeatCell[] } = $props();
</script>

<div class="grid" aria-hidden="true">
	{#each cells as cell (cell.day)}
		<span
			class="cell tile level-{cell.level}"
			class:vacation={cell.vacation}
			class:today={cell.today}
			data-day={cell.day}
			title={cell.label}
		></span>
	{/each}
</div>
<HeatmapDayList {cells} />

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(13, minmax(0, 1fr));
		grid-template-rows: repeat(7, auto);
		grid-auto-flow: column;
		gap: 0.2rem;
		box-sizing: border-box;
		margin-top: var(--space-4);
		/* Room for today's ring at the card's edges. */
		padding: 0.2rem;
	}

	.cell {
		display: block;
		width: 100%;
		aspect-ratio: 1;
	}
</style>
