<script lang="ts">
	// The seven days of a week. Each state has its own visible mark and
	// border shape, so it never depends on colour alone; the full name
	// ("Monday 16 November: active, 42 reviews") is the item's text for
	// screen readers and its tooltip. Words: weekText.ts.
	import type { DayState, WeekDay } from './summary';
	import { dayName, dayShort } from './weekText';

	interface Props {
		days: WeekDay[];
		/** The formatting locale; the browser's when absent. */
		locale?: string;
	}

	let { days, locale }: Props = $props();

	const MARK: Record<DayState, string> = {
		active: '✓',
		inactive: '·',
		vacation: 'V',
		upcoming: '…',
		skipped: '—'
	};
</script>

<ol class="strip">
	{#each days as day (day.date)}
		{@const name = dayName(day, locale)}
		<li class="day {day.state}" title={name}>
			<span class="sr-only">{name}</span>
			<span class="wd" aria-hidden="true">{dayShort(day.date, locale)}</span>
			<span class="mark" aria-hidden="true">{MARK[day.state]}</span>
		</li>
	{/each}
</ol>

<style>
	/* Active: #0b6bcb fill with white text (5.3:1), #6cb4ff on dark with
	   #121212 text (about 8.6:1). Borders are currentColor at 60 % or more
	   (at least 3:1 against the card in both themes); vacation is dashed,
	   upcoming dotted, a skipped day has no border. No animation. */
	.strip {
		list-style: none;
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.35rem;
		margin: 0.75rem 0 0;
		padding: 0;
	}

	.day {
		display: grid;
		justify-items: center;
		gap: 0.15rem;
		padding: 0.3rem 0;
		border: 2px solid color-mix(in srgb, currentColor 60%, transparent);
		border-radius: 0.4rem;
		font-size: 0.75rem;
	}

	.mark {
		font-weight: 700;
		font-size: 0.85rem;
	}

	.active {
		background: #0b6bcb;
		border-color: #0b6bcb;
		color: #fff;
	}

	.vacation {
		border-style: dashed;
	}

	.upcoming {
		border-style: dotted;
		color: color-mix(in srgb, currentColor 75%, transparent);
	}

	.skipped {
		border-color: transparent;
	}

	@media (prefers-color-scheme: dark) {
		.active {
			background: #6cb4ff;
			border-color: #6cb4ff;
			color: #121212;
		}
	}
</style>
