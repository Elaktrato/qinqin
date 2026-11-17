<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatDay, formatNumber, formatWeekday } from '$lib/i18n/format';
	import { addDays } from '$lib/time/studyDay';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { monthGrid, weekdayIndex, type Month } from './calendar';
	import type { HeatCell } from './cells';
	import HeatmapDayList from './HeatmapDayList.svelte';

	// Month calendar: one month, Monday first, with date numbers on bigger
	// tiles, paged month by month (design §9 "Home"). The grid is decorative;
	// the month name is announced when it changes and the list is the
	// accessible form.
	interface Props {
		/** The month on screen (the one whose cells are loaded). */
		month: Month;
		today: string;
		cells: readonly HeatCell[];
		canPrev: boolean;
		canNext: boolean;
		onprev: () => void;
		onnext: () => void;
		/** "Goal reached on 2 of 6 days"; null without a goal. */
		summary: string | null;
	}
	let { month, today, cells, canPrev, canNext, onprev, onnext, summary }: Props = $props();

	const byDay = $derived(new Map(cells.map((cell) => [cell.day, cell])));
	const weeks = $derived(monthGrid(month, today));
	const monday = $derived(addDays(`${month}-01`, -weekdayIndex(`${month}-01`)));
	const weekdays = $derived(Array.from({ length: 7 }, (_, i) => formatWeekday(addDays(monday, i), 'short')));
	const title = $derived(formatDay(`${month}-01`, { month: 'long', year: 'numeric' }));
</script>

<div class="month-head">
	<IconButton icon="back" size="s" label={t('widgets.activity.month.previous')} disabled={!canPrev} onclick={onprev} />
	<h3 class="month-name" aria-live="polite">{title}</h3>
	<IconButton icon="forward" size="s" label={t('widgets.activity.month.next')} disabled={!canNext} onclick={onnext} />
	{#if summary !== null}
		<span class="summary">{summary}</span>
	{/if}
</div>

<div class="month-grid" aria-hidden="true">
	{#each weekdays as name, i (i)}
		<span class="wd">{name}</span>
	{/each}
	{#each weeks.flat() as slot, i (slot.day ?? `pad-${i}`)}
		{#if slot.day === null}
			<span class="blank"></span>
		{:else if slot.future}
			<span class="tile future" data-day={slot.day}><span class="dn">{formatNumber(Number(slot.day.slice(8)))}</span></span>
		{:else}
			{@const cell = byDay.get(slot.day)}
			<span
				class="tile level-{cell?.level ?? 0}"
				class:vacation={cell?.vacation}
				class:today={slot.day === today}
				class:strong={(cell?.level ?? 0) >= 3}
				data-day={slot.day}
				title={cell?.label}
			><span class="dn">{formatNumber(Number(slot.day.slice(8)))}</span></span>
		{/if}
	{/each}
</div>
<HeatmapDayList {cells} />

<style>
	.month-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		margin-top: var(--space-4);
	}

	.month-name {
		margin: 0;
		min-width: 9em;
		text-align: center;
		font-size: var(--font-size-m);
		font-weight: var(--weight-medium);
	}

	.summary {
		margin-left: auto;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.month-grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: var(--space-1);
		max-width: 32.5rem;
		margin-top: var(--space-3);
	}

	.wd {
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
		text-align: center;
	}

	.tile,
	.blank {
		position: relative;
		aspect-ratio: 1;
	}

	.month-grid .tile {
		display: block;
		border-radius: calc(var(--radius) * 0.6);
	}

	/* Day numbers: --text on the light tints, --on-accent on levels 3-4 (Ruling, measured per theme). */
	.dn {
		position: absolute;
		top: 0.2rem;
		left: 0.35rem;
		font-size: var(--font-size-xs);
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.strong .dn {
		color: var(--on-accent);
	}

	.future .dn {
		color: var(--readable-muted);
	}

	@media (forced-colors: active) {
		.dn,
		.strong .dn {
			color: CanvasText;
		}
	}
</style>
