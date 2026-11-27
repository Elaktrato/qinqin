<script lang="ts">
	// The kind label (#101): the task in the accent, then the tags (#286) — the
	// status (tier, re-show, new: `Tag`s from the session's `chips`), and the
	// deck and the level together at the end of the line. Kinds are not
	// colour-coded; the level is the one accent tag. The label is the face's
	// heading: focus moves to it when a new card shows.
	import type { Snippet } from 'svelte';
	import Tag from '$lib/ui/Tag.svelte';

	let {
		kindLabel,
		headingLabel,
		deck = null,
		level = null,
		chips,
		heading = $bindable()
	}: {
		kindLabel: string;
		headingLabel: string;
		deck?: string | null;
		level?: string | null;
		chips?: Snippet;
		heading?: HTMLElement;
	} = $props();
</script>

<header class="face-head">
	<h1 class="kind" tabindex="-1" aria-label={headingLabel} bind:this={heading}>{kindLabel}</h1>
	{#if chips}{@render chips()}{/if}
	{#if deck || level}
		<span class="where">
			{#if deck}<Tag>{deck}</Tag>{/if}
			{#if level}<Tag tone="accent">{level}</Tag>{/if}
		</span>
	{/if}
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
	.where {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		min-width: 0;
		margin-inline-start: auto;
	}
</style>
