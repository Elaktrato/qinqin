<script lang="ts">
	import { t } from '$lib/i18n';
	import type { SentenceCredit } from '$lib/api/types';

	/** The credit of a pack sentence (Tatoeba: CC BY 2.0 FR needs the author named). */
	let { credit }: { credit: SentenceCredit } = $props();

	const who = $derived(credit.owner ? `${credit.source} · ${credit.owner}` : credit.source);
	const translation = $derived(
		credit.translationUrl
			? credit.translationOwner
				? t('entry.sentences.creditTranslation', { owner: credit.translationOwner })
				: t('entry.sentences.creditTranslationBare')
			: ''
	);
</script>

<span class="credit"
	><a href={credit.url} target="_blank" rel="noopener noreferrer">{who}</a
	>{#if translation}
		· <a href={credit.translationUrl} target="_blank" rel="noopener noreferrer">{translation}</a>{/if}</span
>

<style>
	.credit {
		display: inline-block;
		font-size: 0.7rem;
		color: var(--readable-muted);
	}

	.credit a {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
	}

	.credit a:hover,
	.credit a:focus-visible {
		text-decoration-color: currentColor;
	}
</style>
