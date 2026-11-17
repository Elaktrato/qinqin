<script lang="ts">
	// The kind label (#101): the task in the accent, chips (tier, re-show,
	// new), deck · level on the right. Kinds are not colour-coded. The label
	// is the face's heading: focus moves to it when a new card shows.
	import type { Snippet } from 'svelte';

	let {
		kindLabel,
		headingLabel,
		deckLevel,
		chips,
		heading = $bindable()
	}: {
		kindLabel: string;
		headingLabel: string;
		deckLevel: string | null;
		chips?: Snippet;
		heading?: HTMLElement;
	} = $props();
</script>

<header class="face-head">
	<h1 class="kind" tabindex="-1" aria-label={headingLabel} bind:this={heading}>{kindLabel}</h1>
	{#if chips}{@render chips()}{/if}
	{#if deckLevel}<span class="deck">{deckLevel}</span>{/if}
</header>

<style>
	.face-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		font-size: var(--font-size-label);
	}
	.kind {
		margin: 0;
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		line-height: var(--line-body);
		color: var(--reading-accent);
	}
	.kind:focus {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.kind:focus:not(:focus-visible) {
		outline: none;
	}
	.deck {
		margin-inline-start: auto;
		font-weight: var(--weight-regular);
		color: var(--readable-muted);
	}
</style>
