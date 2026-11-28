<script lang="ts">
	import { t } from '$lib/i18n';
	import type { SentenceSource } from '$lib/api/types';
	import { sourceLabel, sourceText } from './sentenceSource';

	/**
	 * Where the reader saved an own sentence (#280): "From title, chapter n",
	 * a link to the reader at the word while the book is there (`linked`),
	 * else text. Review cards pass `linked={false}`: a link would leave the
	 * session with the card ungraded.
	 */
	let { source, linked = true }: { source: SentenceSource; linked?: boolean } = $props();

	const label = $derived(sourceLabel(source));
	const text = $derived(sourceText(source));
</script>

<span class="source"
	>{#if linked && label.href}<a href={label.href}>{text}</a>{:else}{text}{#if label.href === null}{` · ${t('entry.sentences.sourceGone')}`}{/if}{/if}</span
>

<style>
	.source {
		display: inline-block;
		max-width: 100%;
		overflow-wrap: anywhere;
		font-size: 0.7rem;
		color: var(--readable-muted);
	}

	.source a {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
	}

	.source a:hover,
	.source a:focus-visible {
		text-decoration-color: currentColor;
	}
</style>
