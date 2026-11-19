<script lang="ts">
	import type { HeatCell } from './cells';
	import HeatmapDayList from './HeatmapDayList.svelte';

	// Garden grid: the last 52 weeks, one small tile per day in columns of
	// seven, tinted by the day's activity (design §6 heatmap tint). The tiles
	// are decorative (tooltips via title); the list carries the meaning.
	// A narrow screen scrolls horizontally, with the newest week in view.
	let { cells, weeks = 52 }: { cells: readonly HeatCell[]; weeks?: number } = $props();
	let grid = $state<HTMLElement>();
	let scrolled = false;
	$effect(() => {
		if (scrolled || grid === undefined || cells.length === 0) return;
		grid.scrollLeft = grid.scrollWidth;
		scrolled = true;
	});
</script>

<div class="grid" bind:this={grid} style:--garden-weeks={weeks} aria-hidden="true">
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
		grid-template-columns: repeat(var(--garden-weeks, 52), minmax(0.85rem, 1fr));
		grid-template-rows: repeat(7, auto);
		grid-auto-flow: column;
		gap: 0.2rem;
		box-sizing: border-box;
		margin-top: var(--space-4);
		overflow-x: auto;
		/* Room for today's ring at the card's edges. */
		padding: 0.2rem;
	}

	.cell {
		display: block;
		width: 100%;
		aspect-ratio: 1;
	}
</style>
