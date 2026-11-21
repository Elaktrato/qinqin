<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatPercent } from '$lib/i18n/format';
	import { Section, Stat } from '$lib/ui';
	import type { DeckNumbers } from './deckStats';

	// The overall numbers above the deck list: words, cards, studied and
	// mastered, plus the two review statistics of the last 30 learner days
	// (#105's names: Recall is the shared word).
	let { numbers, label = t('flashcards.stats.overall') }: { numbers: DeckNumbers; label?: string } = $props();

	const retention = $derived(numbers.retention === null ? '—' : formatPercent(numbers.retention));
</script>

<Section title={label}>
	<div class="stats">
		<Stat value={String(numbers.words)} label={t('flashcards.stats.words')} />
		<Stat value={String(numbers.cards)} label={t('flashcards.stats.cards')} />
		<Stat value={String(numbers.studied)} label={t('flashcards.stats.studied')} />
		<Stat value={String(numbers.mastered)} label={t('flashcards.stats.mastered')} />
		<Stat value={String(numbers.reviews30)} label={t('flashcards.stats.reviews')} />
		<span
			class="recall"
			title={numbers.retention === null ? t('flashcards.stats.retentionLater') : ''}
		>
			<Stat value={retention} label={t('flashcards.stats.retention')} />
		</span>
	</div>
</Section>

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
		gap: var(--space-3) var(--space-4);
	}

	.recall {
		display: block;
		min-width: 0;
	}
</style>
