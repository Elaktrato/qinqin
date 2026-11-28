<script lang="ts">
	// The glosses of a card's answer (vocab, Starter mode and reverse backs), grouped by dictionary in the order of
	// the sense display rule (docs/contracts/senses, #345): slang, vulgar and derogatory glosses are folded behind
	// "Show n more meanings" and carry their mark when shown. Uses FaceAnswer's .fa-glosses and .fa-source.
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { Tag } from '$lib/ui';
	import { markLabel } from '$lib/entry/entrySenses';
	import type { VocabGlossGroup } from './cardView';

	let { glosses, folded }: { glosses: VocabGlossGroup[]; folded: VocabGlossGroup[] } = $props();

	let revealed = $state(false);
	let root = $state<HTMLElement | null>(null);
	const foldedCount = $derived(folded.reduce((n, g) => n + g.glosses.length, 0));
	const groups = $derived(revealed ? [...glosses, ...folded] : glosses);

	// The button vanishes once pressed: keep keyboard focus on the first meaning it showed.
	async function reveal(): Promise<void> {
		revealed = true;
		await tick();
		root?.querySelector<HTMLElement>('[data-folded-start]')?.focus();
	}
</script>

<div class="glosses" bind:this={root}>
{#each groups as group, groupIndex (groupIndex)}
	{@const start = groupIndex === glosses.length}
	<article class="dictionary">
		<ol class="fa-glosses" tabindex="-1" data-folded-start={start ? '' : undefined}>
			{#each group.glosses as gloss, glossIndex (glossIndex)}
				<li>{#if gloss.mark}<span class="mark"><Tag>{markLabel(gloss.mark)}</Tag></span>{/if}{gloss.text}</li>
			{/each}
		</ol>
		<p class="fa-source">{group.dictionaryName}</p>
	</article>
{/each}
{#if !revealed && foldedCount > 0}
	<button type="button" class="more" onclick={reveal}>{t('flashcards.card.moreMeanings', { count: foldedCount })}</button>
{/if}
</div>

<style>
	.glosses {
		display: contents;
	}
	.dictionary {
		display: grid;
		gap: var(--space-1);
	}
	.mark {
		margin-inline-end: var(--space-1);
	}
	.fa-glosses:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.more {
		justify-self: center;
		min-height: 44px;
		padding: 0 var(--space-2);
		border: none;
		background: none;
		color: var(--reading-accent);
		font: inherit;
		font-size: var(--font-size-label);
		text-decoration: underline;
		cursor: pointer;
	}
</style>
