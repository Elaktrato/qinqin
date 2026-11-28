<script lang="ts">
	// The hints on view for the card (#215), in the fixed order: the readings (as the Recall card's
	// "Show reading" showed them), later the picture (#212/#216). One place draws every hint kind, so
	// Starter mode (#214) and every card kind show a hint the same way.
	import EntryPicture from '$lib/aids/EntryPicture.svelte';
	import ReadingText from '$lib/components/ReadingText.svelte';
	import { t } from '$lib/i18n';
	import type { Entry } from '$lib/api/types';
	import { useCardHints } from './cardHints.svelte';
	import { useRomanisation } from '$lib/languages/useRomanisation';

	let { entry }: { entry: Pick<Entry, 'readings' | 'language'> & Partial<Pick<Entry, 'id'>> } = $props();
	const hints = useCardHints();
	// Hidden romanisation (#284): the reading hint is the readings the learner sees; the hidden ones are the
	// romanisation hint, the last step, shown only when asked for.
	const roman = useRomanisation();
	const shown = $derived(roman.shown(entry.readings));
	const hidden = $derived(roman.hidden(entry.readings));
</script>

{#each hints.visible as kind (kind)}
	{#if kind === 'picture' && entry.id !== undefined}
		<span data-hint="picture"><EntryPicture entryId={entry.id} size={7} /></span>
	{/if}
	{#if kind === 'reading' && shown.length > 0}
		<ul class="hint-readings" data-hint="reading" aria-label={t('flashcards.card.readings')}>
			{#each shown as reading, i (`${reading.type}:${i}`)}
				<li data-type={reading.type}><ReadingText type={reading.type} value={reading.value} language={entry.language} /></li>
			{/each}
		</ul>
	{/if}
	{#if kind === 'romanisation' && hidden.length > 0}
		<ul class="hint-readings" data-hint="romanisation" aria-label={t('flashcards.card.romanisation')}>
			{#each hidden as reading, i (`${reading.type}:${i}`)}
				<li data-type={reading.type}><ReadingText type={reading.type} value={reading.value} language={entry.language} reveal /></li>
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
