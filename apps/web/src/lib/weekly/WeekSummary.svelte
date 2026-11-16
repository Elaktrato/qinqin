<script lang="ts">
	// One week's summary: the labels, the comparison window, the rows as a
	// description list and the seven-day strip. Every word and number comes
	// from weekText.ts (summaryLines); this component only lays them out.
	import type { WeekView } from './loadWeek';
	import type { Pair } from './summary';
	import WeekStrip from './WeekStrip.svelte';
	import { compareWindowText, summaryLines } from './weekText';

	interface Props {
		view: WeekView;
		/** 'pending' while counting, null when not shown. */
		characters?: Pair | null | 'pending';
		/** The home widget's short form. */
		compact?: boolean;
		/** Retry the activity request (offline). */
		onretry?: () => void;
		locale?: string;
	}

	let { view, characters = null, compact = false, onretry, locale }: Props = $props();

	const lines = $derived(summaryLines(view.summary, view.sources, characters, compact));
	const ARROW = { up: '▲', down: '▼', same: '=' } as const;
</script>

<div class="week-summary" class:compact>
	{#if view.summary.inProgress || view.summary.allVacation}
		<p class="labels">
			{#if view.summary.inProgress}<span class="badge">In progress</span>{/if}
			{#if view.summary.allVacation}<span class="badge">On vacation all week</span>{/if}
		</p>
	{/if}
	{#if view.activityError !== null}
		<p class="offline" role="status">
			Reviews, reading and journal numbers are not available offline.
			{#if onretry}<button type="button" class="retry" onclick={onretry}>Retry</button>{/if}
		</p>
	{/if}
	<p class="window">{compareWindowText(view.summary, locale)}</p>

	<dl>
		{#each lines as line (line.id)}
			<div class="row">
				<dt>{line.term}</dt>
				<dd>
					<span class="value">{line.value}</span>
					{#if line.comparison !== null}
						<span class="cmp">
							{#if line.trend !== null}<span class="arrow" aria-hidden="true">{ARROW[line.trend]}</span>{/if}
							{line.comparison}
						</span>
					{/if}
				</dd>
			</div>
		{/each}
	</dl>

	<WeekStrip days={view.summary.days} {locale} />
</div>

<style>
	.week-summary {
		display: grid;
		gap: 0.25rem;
	}

	.labels {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.5rem 0 0;
	}

	.badge {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.1rem 0.5rem;
		border: 1px solid currentColor;
		border-radius: 999px;
	}

	.window,
	.offline {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
	}

	.retry {
		font: inherit;
		font-size: 0.8rem;
		margin-left: 0.35rem;
		padding: 0.15rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 60%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	dl {
		display: grid;
		gap: 0.45rem;
		margin: 0.75rem 0 0;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(8rem, 1fr) 2fr;
		gap: 0.75rem;
	}

	.compact .row {
		grid-template-columns: minmax(6rem, 1fr) 2fr;
	}

	dt {
		font-weight: 600;
	}

	dd {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.75rem;
	}

	.value {
		font-variant-numeric: tabular-nums;
	}

	.cmp {
		font-size: 0.85rem;
	}

	.arrow {
		margin-right: 0.2rem;
	}
</style>
