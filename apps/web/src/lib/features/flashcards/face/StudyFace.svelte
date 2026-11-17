<script lang="ts">
	// The study session's "open page" (#101, design §9 Flashcards): no card
	// box; every kind has the same four parts in the same places — the kind
	// label (deck · level on the right), the prompt, the answer area and the
	// answer below a hairline — between the session top and the docked
	// actions. The card fills its regions with FacePrompt / FaceWork /
	// FaceAnswer and registers its primary action (cardFace.svelte.ts); the
	// session provides the face and passes the grade bar.
	//
	// API: <StudyFace kindLabel deckLevel cardLabel headingLabel progress countText done keys chips? note? grades? bind:heading>card</StudyFace>
	import type { Snippet } from 'svelte';
	import ActionDock from './ActionDock.svelte';
	import FaceHeader from './FaceHeader.svelte';
	import SessionTop from './SessionTop.svelte';

	let {
		kindLabel,
		deckLevel,
		cardLabel,
		headingLabel,
		progress,
		countText,
		done,
		keys,
		chips,
		note,
		status,
		grades,
		heading = $bindable(),
		children
	}: {
		kindLabel: string;
		deckLevel: string | null;
		cardLabel: string;
		headingLabel: string;
		progress: { position: number; total: number };
		countText: string;
		done: boolean;
		keys: string;
		chips?: Snippet;
		note?: Snippet;
		status?: Snippet;
		grades?: Snippet;
		heading?: HTMLElement;
		children: Snippet;
	} = $props();
</script>

<div class="study-face">
	<SessionTop {progress} {countText} />
	<article class="fc" aria-label={cardLabel}>
		<FaceHeader {kindLabel} {headingLabel} {deckLevel} {chips} bind:heading />
		{@render children()}
		{#if note}{@render note()}{/if}
		{#if status}{@render status()}{/if}
	</article>
	<ActionDock {done} {grades} {keys} />
</div>

<style>
	.study-face {
		box-sizing: border-box;
		display: grid;
		grid-template-rows: auto 1fr auto auto;
		gap: var(--space-4);
		width: 100%;
		max-width: 33.75rem;
		min-height: calc(100dvh - 4.5rem);
		margin: 0 auto;
		padding: var(--space-3) var(--space-4) 0;
	}
	.fc {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: var(--space-4);
		min-width: 0;
	}
</style>
