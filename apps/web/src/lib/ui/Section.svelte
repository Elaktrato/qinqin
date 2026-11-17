<script lang="ts">
	// A titled group without a box (design §5: "a box needs a reason"): a
	// small sentence-case heading, space, and a --hair line above the next
	// Section. A region named by its heading; untitled Sections are plain
	// groups.
	//
	// API: <Section title? level? actions?>content</Section>
	//   title    the heading (t(…)); sentence case, never all caps
	//   level    the heading level 2 (default) | 3 | 4 — follow the page outline
	//   actions  a snippet shown at the heading's end (plain or IconButtons)
	import type { Snippet } from 'svelte';

	let {
		title,
		level = 2,
		actions,
		children
	}: { title?: string; level?: 2 | 3 | 4; actions?: Snippet; children: Snippet } = $props();

	const uid = $props.id();
</script>

<section class="section qq-section" aria-labelledby={title ? `${uid}-h` : undefined}>
	{#if title || actions}
		<div class="head">
			{#if title}<svelte:element this={`h${level}`} id="{uid}-h" class="title">{title}</svelte:element>{/if}
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</div>
	{/if}
	{@render children()}
</section>

<style>
	.section {
		padding-block: var(--space-4);
	}
	/* Sections are separate component instances: the sibling rule is global. */
	:global(.qq-section + .qq-section) {
		border-top: 1px solid var(--hair);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.title {
		margin: 0;
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
		line-height: var(--line-tight);
		color: var(--text);
	}
	.actions {
		display: flex;
		gap: var(--space-1);
	}
</style>
