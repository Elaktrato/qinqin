<script lang="ts">
	// A number with its label (design §5, §9 Stats): the number large and
	// light (regular weight, tight), the label small and muted, read first.
	// An optional change line: its words are the meaning; an arrow (shape)
	// in --good (up) or --grade-hard (down) repeats it.
	//
	// API: <Stat value label change? />
	//   value   the formatted number (format it with the i18n formatters)
	//   label   what it counts (t(…)), sentence case
	//   change  { text, direction: 'up' | 'down' | 'same' }
	import Icon from './Icon.svelte';

	let {
		value,
		label,
		change
	}: { value: string; label: string; change?: { text: string; direction: 'up' | 'down' | 'same' } } = $props();
</script>

<div class="stat">
	<span class="label">{label}</span>
	<span class="value">{value}</span>
	{#if change}
		<span class="change {change.direction}"
			>{#if change.direction !== 'same'}<Icon name={change.direction === 'up' ? 'arrow-up' : 'arrow-down'} size="s" />{/if}<span
				>{change.text}</span
			></span
		>
	{/if}
</div>

<style>
	.stat {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.label {
		order: 2;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	.value {
		order: 1;
		font-size: var(--font-size-xxl);
		font-weight: var(--weight-regular);
		line-height: var(--line-tight);
		letter-spacing: var(--tracking-tight);
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.change {
		order: 3;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	.up :global(svg) {
		color: var(--good);
	}
	.down :global(svg) {
		color: var(--grade-hard);
	}
	@media (forced-colors: active) {
		.change :global(svg) {
			color: CanvasText;
		}
	}
</style>
