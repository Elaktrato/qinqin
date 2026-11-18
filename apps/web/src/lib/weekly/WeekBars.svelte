<script lang="ts">
	// The Week tab's paired bars: each day of the shown week beside the same
	// weekday of the week before, scaled to the busiest day of both weeks.
	// The bars are decorative (aria-hidden); each column's tooltip and a
	// visually hidden list carry the day and both amounts, and the legend
	// names the two weeks (design §9, "never colour alone").
	import { t } from '$lib/i18n';
	import { formatNumber, formatWeekday } from '$lib/i18n/format';
	import type { WeekDay, WeekSummary } from './summary';
	import { dayShort } from './weekText';

	interface Props {
		summary: Pick<WeekSummary, 'days' | 'previousDays'>;
		locale?: string;
	}

	let { summary, locale }: Props = $props();

	const busiest = $derived(
		Math.max(
			1,
			...summary.days.map((day) => day.points ?? 0),
			...summary.previousDays.map((day) => day.points ?? 0)
		)
	);

	const STATE: Record<WeekDay['state'], () => string> = {
		active: () => t('weekly.day.active'),
		inactive: () => t('weekly.day.inactive'),
		vacation: () => t('weekly.day.vacation'),
		upcoming: () => t('weekly.day.upcoming'),
		skipped: () => t('weekly.day.skipped')
	};

	function amount(points: number | null): string {
		return points === null ? t('weekly.offline') : t('stats.activity.points', { count: points });
	}

	function text(day: WeekDay, previous: WeekDay | undefined): string {
		const now = day.state === 'upcoming' ? amount(0) : amount(day.points);
		// The template says "… this week, 30 last week": only the first amount
		// spells out its unit.
		const last = previous?.points === null ? t('weekly.offline') : formatNumber(previous?.points ?? 0);
		const base = t('weekly.bars.day', {
			day: formatWeekday(day.date, 'long', locale),
			now,
			last
		});
		return `${base}, ${STATE[day.state]()}`;
	}

	function height(points: number | null): string {
		return `${((points ?? 0) / busiest) * 100}%`;
	}
</script>

<div class="week-bars">
	<p class="title">{t('weekly.bars.title')}</p>
	<ul class="legend">
		<li><span class="key now" aria-hidden="true"></span>{t('weekly.bars.thisWeek')}</li>
		<li><span class="key last" aria-hidden="true"></span>{t('weekly.bars.lastWeek')}</li>
	</ul>

	<div class="chart" aria-hidden="true">
		{#each summary.days as day, index (day.date)}
			{@const previous = summary.previousDays[index]}
			{@const label = text(day, previous)}
			<div class="column" data-day={day.date} title={label}>
				<div class="pair">
					{#if day.state !== 'upcoming' && (day.points ?? 0) > 0}
						<span class="bar now" style:height={height(day.points)}></span>
					{/if}
					{#if (previous?.points ?? 0) > 0}
						<span class="bar last" style:height={height(previous?.points ?? 0)}></span>
					{/if}
				</div>
				<span class="weekday">{dayShort(day.date, locale)}</span>
			</div>
		{/each}
	</div>

	<ul class="sr-only">
		{#each summary.days as day, index (day.date)}
			<li>{text(day, summary.previousDays[index])}</li>
		{/each}
	</ul>
</div>

<style>
	.title {
		margin: 0;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: var(--space-2) 0 0;
		padding: 0;
		list-style: none;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.legend li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.key {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 2px;
	}

	.key.now {
		background: var(--accent);
	}

	.key.last {
		background: color-mix(in srgb, var(--muted) 35%, transparent);
		/* The wash is under 3:1 on panel in every built-in theme; the legend's
		   outline names the second week together with its text. */
		border: 1px solid var(--line);
	}

	.chart {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: var(--space-3);
		height: 120px;
		margin-top: var(--space-2);
		box-shadow: inset 0 -1px 0 var(--hair);
	}

	.column {
		display: grid;
		grid-template-rows: 1fr auto;
		gap: var(--space-1);
		min-width: 0;
	}

	.pair {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 2px;
		min-height: 0;
	}

	.bar {
		width: 40%;
		min-height: 2px;
		border-radius: 2px 2px 0 0;
	}

	.bar.now {
		background: var(--accent);
	}

	.bar.last {
		background: color-mix(in srgb, var(--muted) 35%, transparent);
	}

	.weekday {
		text-align: center;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	@media (max-width: 719px) {
		.chart {
			height: 100px;
			gap: var(--space-2);
		}
	}

	@media (forced-colors: active) {
		.bar.now {
			background: CanvasText;
		}
		.bar.last {
			background: transparent;
			border: 1px dashed CanvasText;
			border-bottom: 0;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
