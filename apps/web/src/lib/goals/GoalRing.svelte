<script lang="ts">
	// The daily goal's progress ring. Words and geometry live in goalText.ts
	// and ring.ts; this only draws them. Without a goal it renders nothing; on
	// vacation or for an activity that is no longer counted only a status line.
	import type { ActivitySource } from '$lib/api/stats';
	import { ariaText, shortText, statusLine } from './goalText';
	import type { GoalDay } from './progress';
	import { ringArc } from './ring';

	interface Props {
		day: GoalDay;
		sources: ActivitySource[];
		size?: 'large' | 'small';
	}

	let { day, sources, size = 'large' }: Props = $props();

	const box = $derived(size === 'small' ? 32 : 72);
	const stroke = $derived(size === 'small' ? 4 : 8);
	const radius = $derived((box - stroke) / 2);
	const arc = $derived(ringArc(day.fraction, radius));
	const showBar = $derived(
		!day.unavailable && (day.status === 'met' || day.status === 'open' || day.status === 'missed')
	);
	const reached = $derived(day.status === 'met');
	const valueText = $derived(ariaText(day, sources));
	const line = $derived(statusLine(day));
</script>

{#if showBar && day.target !== null}
	<div
		class="goal-ring {size}"
		class:reached
		role="progressbar"
		aria-label="Daily goal"
		aria-valuemin="0"
		aria-valuemax={day.target}
		aria-valuenow={Math.min(day.amount, day.target)}
		aria-valuetext={valueText}
	>
		<svg width={box} height={box} viewBox="0 0 {box} {box}" aria-hidden="true">
			<circle class="track" cx={box / 2} cy={box / 2} r={radius} stroke-width={stroke} />
			<circle
				class="fill"
				cx={box / 2}
				cy={box / 2}
				r={radius}
				stroke-width={stroke}
				stroke-dasharray={arc.circumference}
				stroke-dashoffset={arc.dashOffset}
				transform="rotate(-90 {box / 2} {box / 2})"
			/>
		</svg>
		{#if reached}<span class="check" aria-hidden="true">✓</span>{/if}
		{#if size === 'small'}
			<span class="text short" aria-hidden="true">{shortText(day)}</span>
			<!-- Reached is said in words, not by colour or the check mark alone. -->
			{#if reached}<span class="reached-word" aria-hidden="true">Goal reached</span>{/if}
		{:else}
			<p class="text">{valueText}</p>
		{/if}
	</div>
{:else if line !== null}
	<p class="status">{line}</p>
{/if}

<style>
	/* Fill #0b6bcb on light (5.3:1 against white) and #6cb4ff on dark (about
	   8.6:1 against a #121212 canvas); the track is currentColor at 50 % (about
	   3.9:1 light, 5.3:1 dark). The card itself has no background of its own. */
	.goal-ring {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.goal-ring.small {
		gap: 0.35rem;
	}

	svg {
		flex: none;
	}

	circle {
		fill: none;
	}

	.track {
		stroke: color-mix(in srgb, currentColor 50%, transparent);
	}

	.fill {
		stroke: #0b6bcb;
		stroke-linecap: round;
		transition: stroke-dashoffset 0.4s ease-out;
	}

	@media (prefers-color-scheme: dark) {
		.fill {
			stroke: #6cb4ff;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.fill {
			transition: none;
		}
	}

	.text {
		margin: 0;
		font-size: 0.95rem;
	}

	.short {
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}

	.check {
		font-weight: 700;
		color: #1b7f3b;
	}

	@media (prefers-color-scheme: dark) {
		.check {
			color: #6fd08c;
		}
	}

	.reached-word {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.reached .text {
		font-weight: 600;
	}

	.status {
		margin: 0;
		font-size: 0.9rem;
		opacity: 0.85;
	}
</style>
