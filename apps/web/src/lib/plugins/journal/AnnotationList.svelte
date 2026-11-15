<script lang="ts">
	import type { Annotation } from './types';

	let {
		listed,
		missing,
		onpick
	}: { listed: Annotation[]; missing: Annotation[]; onpick: (id: string) => void } = $props();
</script>

<section class="annotations" aria-labelledby="annotations-heading">
	<h3 id="annotations-heading">All corrections ({listed.length})</h3>
	{#if listed.length === 0}
		<p class="hint">No corrections in the current text.</p>
	{:else}
		<ol>
			{#each listed as a (a.id)}
				<li>
					<button type="button" class="secondary" onclick={() => onpick(a.id)}>
						<span class="quote">{a.quote}</span>
						<span aria-hidden="true">→</span>
						<span class="sr">corrected to</span>
						<strong>{a.correction}</strong>
					</button>
				</li>
			{/each}
		</ol>
	{/if}

	{#if missing.length > 0}
		<h3>No longer in the text</h3>
		<p class="hint">You changed these words after the review.</p>
		<ul>
			{#each missing as a (a.id)}
				<li class="gone">
					<p><span class="quote">{a.quote}</span> → <strong>{a.correction}</strong></p>
					<p class="why">{a.explanation}</p>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	ol,
	ul {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: grid;
		gap: 0.4rem;
	}

	li button {
		width: 100%;
		min-height: 2.75rem;
		text-align: left;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		padding: 0.4rem 0.75rem;
		border-radius: 0.4rem;
		font: inherit;
		cursor: pointer;
		overflow-wrap: anywhere;
	}

	.quote {
		text-decoration: line-through;
		opacity: 0.85;
	}

	.gone {
		border: 1px dashed color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		padding: 0.4rem 0.75rem;
		overflow-wrap: anywhere;
	}

	.gone p {
		margin: 0.2rem 0;
	}

	.why {
		white-space: pre-wrap;
		opacity: 0.85;
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
