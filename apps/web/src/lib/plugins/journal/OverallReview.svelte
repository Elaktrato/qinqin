<script lang="ts">
	import type { Review } from './types';

	let { review }: { review: Review } = $props();
</script>

<section class="overall" aria-labelledby="overall-heading">
	<h3 id="overall-heading">Overall</h3>
	<p class="summary">{review.overall.summary}</p>
	{#if review.overall.strengths.length > 0}
		<h4>What went well</h4>
		<ul>
			{#each review.overall.strengths as s, i (i)}<li>{s}</li>{/each}
		</ul>
	{/if}
	{#if review.overall.focus.length > 0}
		<h4>Focus next</h4>
		<ul>
			{#each review.overall.focus as f, i (i)}<li>{f}</li>{/each}
		</ul>
	{/if}
	<p class="meta">
		{#if review.fallbackFrom}
			Answered by {review.model} (fallback)
		{:else}
			Answered by {review.model}
		{/if}
	</p>
</section>

<style>
	.summary {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	h4 {
		margin: 0.75rem 0 0.25rem;
	}

	ul {
		margin: 0;
		padding-left: 1.2rem;
		overflow-wrap: anywhere;
	}

	.meta {
		font-size: 0.85rem;
		opacity: 0.75;
	}
</style>
