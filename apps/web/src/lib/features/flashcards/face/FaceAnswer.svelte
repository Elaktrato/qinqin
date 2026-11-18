<script lang="ts">
	// The answer (#101): below a --hair line; a region named "Answer" for
	// screen readers (the heading is visually hidden: the line shows it).
	// Shared classes: .fa-readings (a centred row: reading + play),
	// .fa-reading (--reading-accent, 500), .fa-word (CJK 2.5rem), .fa-glosses,
	// .fa-play (the round play button in the accent), .fa-source (small, muted).
	import type { Snippet } from 'svelte';
	import { t } from '$lib/i18n';

	let { children }: { children: Snippet } = $props();
	const uid = $props.id();
</script>

<section class="face-answer" aria-labelledby="{uid}-h">
	<h2 id="{uid}-h" class="visually-hidden">{t('flashcards.card.answer')}</h2>
	{@render children()}
</section>

<style>
	.face-answer {
		display: grid;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--hair);
		text-align: center;
		overflow-wrap: anywhere;
	}
	.face-answer :global(:where(p)) {
		margin: 0;
	}
	.face-answer :global(.fa-readings) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.face-answer :global(.fa-reading) {
		color: var(--reading-accent);
		font-size: 1.125rem;
		font-weight: var(--weight-medium);
	}
	.face-answer :global(.fa-word) {
		font-family: var(--font-hanzi);
		font-size: 2.5rem;
		font-weight: var(--weight-regular);
		line-height: var(--line-tight);
	}
	.face-answer :global(.fa-glosses) {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.face-answer :global(.fa-play .play) {
		width: 2rem;
		height: 2rem;
		color: var(--reading-accent);
	}
	.face-answer :global(.fa-source) {
		color: var(--readable-muted);
		font-size: var(--font-size-label);
	}
</style>
