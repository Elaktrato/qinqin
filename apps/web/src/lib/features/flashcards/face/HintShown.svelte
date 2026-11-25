<script lang="ts">
	// The hints on view for the card (#215), in the fixed order: the readings (as the Recall card's
	// "Show reading" showed them), and the picture (#216). One place draws every hint kind, so
	// Starter mode (#214) and every card kind show a hint the same way.
	import ReadingText from '$lib/components/ReadingText.svelte';
	import { t } from '$lib/i18n';
	import type { Entry } from '$lib/api/types';
	import { pictureCreditLine, themeSvg } from '$lib/api/images';
	import { useCardHints } from './cardHints.svelte';

	let { entry }: { entry: Pick<Entry, 'readings' | 'language'> } = $props();
	const hints = useCardHints();
</script>

{#each hints.visible as kind (kind)}
	{#if kind === 'reading' && entry.readings.length > 0}
		<ul class="hint-readings" data-hint="reading" aria-label={t('flashcards.card.readings')}>
			{#each entry.readings as reading, i (`${reading.type}:${i}`)}
				<li data-type={reading.type}><ReadingText type={reading.type} value={reading.value} language={entry.language} /></li>
			{/each}
		</ul>
	{/if}
	{#if kind === 'picture' && hints.picture}
		{@const picture = hints.picture}
		<figure class="hint-picture" data-hint="picture">
			<!-- The pack's own drawing, checked on the server and again by entryPicture (safeSvg); black outlines
			take the text colour (themeSvg). -->
			<span class="drawing" role="img" aria-label={picture.label}>{@html themeSvg(picture.svg)}</span>
			<figcaption>{pictureCreditLine(picture)}</figcaption>
		</figure>
	{/if}
{/each}

<style>
	.hint-picture {
		display: grid;
		justify-items: center;
		gap: var(--space-1);
		margin: 0;
	}
	.drawing {
		display: block;
		inline-size: 8rem;
		block-size: 8rem;
		color: var(--text);
	}
	.drawing :global(svg) {
		inline-size: 100%;
		block-size: 100%;
	}
	figcaption {
		color: var(--readable-muted);
		font-size: var(--font-size-xs);
	}
	.hint-readings {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--reading-accent);
	}
</style>
