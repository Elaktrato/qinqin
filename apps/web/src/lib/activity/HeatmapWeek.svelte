<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatWeekday } from '$lib/i18n/format';
	import type { HeatCell } from './cells';
	import HeatmapDayList from './HeatmapDayList.svelte';

	// This week: Monday..Sunday of the learner's week as seven large tiles
	// with the amount under each (design §9 "Home"). The whole block is one
	// link to Stats → Week; the tiles inside are decorative.
	interface Props {
		/** Seven cells, Monday first; days after today are `future`. */
		cells: readonly HeatCell[];
		/** "29 flashcard reviews to go today", "Goal reached", "84 points this week". */
		summary: string;
	}
	let { cells, summary }: Props = $props();
</script>

<p class="summary">{summary}</p>
<a class="week" href="/stats/week" aria-label={t('widgets.activity.week.link')}>
	<span class="week-days" aria-hidden="true">
		{#each cells as cell (cell.day)}
			<span class="day">
				<span class="wd">{formatWeekday(cell.day, 'short')}</span>
				<span
					class="tile level-{cell.future ? 0 : cell.level}"
					class:future={cell.future}
					class:vacation={cell.vacation}
					class:today={cell.today}
					data-day={cell.day}
					title={cell.future ? undefined : cell.label}
				></span>
				<span class="amount">{cell.future ? '' : cell.amountText}</span>
			</span>
		{/each}
	</span>
</a>
<HeatmapDayList {cells} />

<style>
	.summary {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.week {
		display: block;
		max-width: 38.75rem;
		margin-top: var(--space-3);
		padding: var(--space-1);
		border-radius: var(--radius);
		color: inherit;
		text-decoration: none;
	}

	.week:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.week-days {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.day {
		display: grid;
		gap: var(--space-1);
		justify-items: center;
		text-align: center;
	}

	.wd,
	.amount {
		font-size: var(--font-size-xs);
		font-variant-numeric: tabular-nums;
	}

	.wd {
		color: var(--readable-muted);
	}

	.week-days .tile {
		display: block;
		width: 100%;
		max-width: 4.75rem;
		aspect-ratio: 1;
		border-radius: calc(var(--radius) * 0.8);
	}

	/* The amount line keeps its height on future days. */
	.amount {
		min-height: 1.2em;
	}
</style>
