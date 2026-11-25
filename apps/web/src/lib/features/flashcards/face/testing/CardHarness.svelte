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
		status,
		kindLabel = 'Recognise',
		deckLevel = null,
		done = false,
		onend,
		instance = $bindable()
	}: {
		card: Component<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
		cardProps?: Record<string, unknown>;
		chips?: Snippet;
		status?: Snippet;
		kindLabel?: string;
		deckLevel?: string | null;
		done?: boolean;
		onend?: () => void;
		instance?: unknown;
	} = $props();

	provideCardFace();
	const Card = $derived(card);

	/** The rendered card's instance (its exported functions, e.g. ReverseCard.finish). */
	export function cardInstance(): unknown {
		return instance;
	}
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
	{status}
	{onend}
	keys="Keys: test"
>
	<Card bind:this={instance} {...cardProps} />
</StudyFace>
