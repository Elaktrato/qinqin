<script lang="ts">
	import { t } from '$lib/i18n';
	import { onMount } from 'svelte';
	import { answeredBy } from './answeredBy';
	import { loadProviderNames } from './providerNames';
	import type { Review } from './types';

	let { review }: { review: Review } = $props();

	// null while the names load: the line then names the model alone.
	let names = $state<Map<string, string> | null>(null);
	onMount(() => {
		void loadProviderNames().then((m) => (names = m));
	});
	const providerName = $derived(
		review.provider && names ? (names.get(review.provider) ?? review.provider) : undefined
	);
</script>

<section class="overall" aria-labelledby="overall-heading">
	<h3 id="overall-heading">{t('journal.overall.title')}</h3>
	<p class="summary">{review.overall.summary}</p>
	{#if review.overall.strengths.length > 0}
		<h4>{t('journal.overall.strengths')}</h4>
		<ul>
			{#each review.overall.strengths as s, i (i)}<li>{s}</li>{/each}
		</ul>
	{/if}
	{#if review.overall.focus.length > 0}
		<h4>{t('journal.overall.focus')}</h4>
		<ul>
			{#each review.overall.focus as f, i (i)}<li>{f}</li>{/each}
		</ul>
	{/if}
	<p class="meta">
		{answeredBy(review.model, providerName, review.fallbackFrom)}
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
