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
		grid-template-rows: repeat(7, 0.85rem);
		grid-auto-flow: column;
		grid-auto-columns: 0.85rem;
		gap: 0.2rem;
		margin-top: var(--space-4);
		overflow-x: auto;
		/* Room for today's ring inside the scroll box. */
		padding: 0.2rem;
	}

	.cell {
		display: block;
		width: 0.85rem;
		height: 0.85rem;
	}
</style>
