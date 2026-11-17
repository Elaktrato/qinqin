<script lang="ts">
	// A chip (design §9 entry: level, frequency rank, kind, "In N decks"): a
	// small label on a --raised wash, no border (§5: no bordered pills). The
	// text says the meaning; `good` adds a dot in --good (a shape, so the
	// colour is never the only cue); `accent` uses the readable accent text.
	//
	// API: <Chip tone?>text</Chip>
	//   tone  'neutral' (default) | 'accent' | 'good'
	import type { Snippet } from 'svelte';

	let { tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'good'; children: Snippet } = $props();
</script>

<span class="chip {tone}">{#if tone === 'good'}<span class="dot" aria-hidden="true"></span>{/if}{@render children()}</span>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0.1em var(--space-2);
		border-radius: var(--radius);
		background: var(--raised);
		color: var(--text);
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		line-height: var(--line-body);
		white-space: nowrap;
	}
	.accent {
		color: var(--reading-accent);
	}
	.dot {
		width: 0.45em;
		height: 0.45em;
		border-radius: 50%;
		background: var(--good);
	}
	@media (forced-colors: active) {
		.chip {
			outline: 1px solid CanvasText;
		}
		.dot {
			background: CanvasText;
		}
	}
</style>
