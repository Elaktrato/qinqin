<script lang="ts">
	// Test harness: provides the card face and renders StudyFace around one
	// card, so the card dom tests see the docked primary action. Never shipped.
	import type { Component, Snippet } from 'svelte';
	import StudyFace from '../StudyFace.svelte';
	import { provideCardFace } from '../cardFace.svelte';

	let {
		card,
		cardProps = {},
		chips,
		kindLabel = 'Recognise',
		deckLevel = null,
		done = false,
		instance = $bindable()
	}: {
		card: Component<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
		cardProps?: Record<string, unknown>;
		chips?: Snippet;
		kindLabel?: string;
		deckLevel?: string | null;
		done?: boolean;
		instance?: unknown;
	} = $props();

	provideCardFace();
	const Card = $derived(card);
</script>

<StudyFace
	{kindLabel}
	{deckLevel}
	cardLabel="{kindLabel} card"
	headingLabel="{kindLabel} card, 1 of 3"
	progress={{ position: 1, total: 3 }}
	countText="1 / 3"
	{done}
	{chips}
	keys="Keys: test"
>
	<Card bind:this={instance} {...cardProps} />
</StudyFace>
