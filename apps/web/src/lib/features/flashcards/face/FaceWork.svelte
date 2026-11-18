<script lang="ts">
	// The card's answer area (#101): nothing, an underline field, choices,
	// word tiles, a writing pad or tone pads — all hairline, centred.
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="face-work">{@render children()}</div>

<style>
	.face-work {
		display: grid;
		gap: var(--space-3);
		justify-items: center;
		align-content: start;
		width: 100%;
		min-width: 0;
	}
	.face-work:empty {
		display: none;
	}
</style>
