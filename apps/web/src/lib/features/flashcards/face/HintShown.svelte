<script lang="ts">
	// The hints on view for the card (#215), in the fixed order: the readings (as the Recall card's
	// "Show reading" showed them), later the picture (#212/#216). One place draws every hint kind, so
	// Starter mode (#214) and every card kind show a hint the same way.
	import ReadingText from '$lib/components/ReadingText.svelte';
	import { t } from '$lib/i18n';
	import type { Entry } from '$lib/api/types';
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
{/each}

<style>
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
