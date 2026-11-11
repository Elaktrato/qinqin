<script lang="ts">
	import type { Sentence } from '$lib/api/types';

	let { sentences }: { sentences: Sentence[] } = $props();

	// Pack sentences carry their source pack; user sentences have no
	// pack, so they are labelled with the user that wrote them.
	function origin(sentence: Sentence): string {
		if (sentence.userId !== null) {
			return sentence.sourcePack
				? `${sentence.sourcePack} · user #${sentence.userId}`
				: `user #${sentence.userId}`;
		}
		return sentence.sourcePack || 'shared';
	}
</script>

{#if sentences.length > 0}
	<section class="sentences" aria-labelledby="sentences-heading">
		<h2 id="sentences-heading">Example sentences</h2>
		<ul>
			{#each sentences as sentence (sentence.id)}
				<li class="sentence">
					<p class="hanzi">{sentence.hanzi}</p>
					{#if sentence.pinyin}<p class="pinyin">{sentence.pinyin}</p>{/if}
					{#if sentence.translation}<p class="translation">{sentence.translation}</p>{/if}
					<span class="origin">{origin(sentence)}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.sentences {
		margin-top: 2rem;
	}

	.sentences h2,
	.sentences ul {
		margin: 0;
	}

	.sentences h2 {
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.sentences ul {
		list-style: none;
		padding: 0;
		margin-top: 0.5rem;
		display: grid;
		gap: 0.75rem;
	}

	.sentence {
		padding: 0.65rem 0.85rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
	}

	.sentence p {
		margin: 0;
	}

	.hanzi {
		font-size: 1.15rem;
	}

	.pinyin {
		font-size: 0.9rem;
		opacity: 0.8;
	}

	.translation {
		font-size: 0.95rem;
	}

	.origin {
		display: inline-block;
		margin-top: 0.35rem;
		font-size: 0.7rem;
		opacity: 0.65;
	}
</style>
