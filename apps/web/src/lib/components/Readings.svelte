<script lang="ts">
	import type { Reading } from '$lib/api/types';
	import { formatReading } from '$lib/format';

	let { readings }: { readings: Reading[] } = $props();

	// The API orders readings, but ord is the contract: sort a copy so a
	// badly ordered pack still displays predictably.
	const ordered = $derived([...readings].sort((a, b) => a.ord - b.ord));
</script>

{#if ordered.length > 0}
	<section class="readings" aria-labelledby="readings-heading">
		<h2 id="readings-heading">Readings</h2>
		<ul>
			{#each ordered as reading, index (`${reading.type}:${reading.ord}:${index}`)}
				<li data-type={reading.type}>{formatReading(reading.type, reading.value)}</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.readings h2,
	.readings ul {
		margin: 0;
	}

	.readings {
		margin-top: 2rem;
	}

	.readings h2 {
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.readings ul {
		list-style: none;
		padding: 0;
		margin-top: 0.5rem;
		display: grid;
		gap: 0.3rem;
	}

	.readings li {
		font-size: 1.05rem;
	}
</style>
