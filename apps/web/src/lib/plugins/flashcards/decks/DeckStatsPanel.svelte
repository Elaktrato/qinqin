<script lang="ts">
	import type { DeckNumbers } from './deckStats';

	// The overall numbers above the deck list: words, studied, mastered and
	// the two review statistics of the last 30 learner days.
	let { numbers, label = 'Overall' }: { numbers: DeckNumbers; label?: string } = $props();

	const retention = $derived(
		numbers.retention === null ? '—' : `${Math.round(numbers.retention * 100)}%`
	);
</script>

<section class="panel" aria-label={label}>
	<dl>
		<div><dt>Words</dt><dd>{numbers.words}</dd></div>
		<div><dt>Studied</dt><dd>{numbers.studied}</dd></div>
		<div><dt>Mastered</dt><dd>{numbers.mastered}</dd></div>
		<div>
			<dt>Retention (30 days)</dt>
			<dd title={numbers.retention === null ? 'Shown after 10 repeat reviews' : ''}>{retention}</dd>
		</div>
		<div><dt>Reviews (30 days)</dt><dd>{numbers.reviews30}</dd></div>
	</dl>
</section>

<style>
	.panel {
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 0.5rem;
	}

	dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
		gap: 0.5rem 1rem;
		margin: 0;
	}

	dt {
		font-size: 0.8rem;
		opacity: 0.75;
	}

	dd {
		margin: 0;
		font-size: 1.3rem;
		font-weight: 600;
	}
</style>
