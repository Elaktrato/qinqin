<script lang="ts">
	// Test harness: provides the card face and renders StudyFace around one
	// card, so the card dom tests see the docked primary action. Never shipped.
	import type { Component, Snippet } from 'svelte';
	import StudyFace from '../StudyFace.svelte';
	import { provideCardFace } from '../cardFace.svelte';
	import HintScope from '../HintScope.svelte';
	import { EMPTY_PLAN, type HintPlan } from '../hints';
	import type { CardHints } from '../cardHints.svelte';

	let {
		card,
		cardProps = {},
		chips,
		status,
		kindLabel = 'Recognise',
		deck = null,
		level = null,
		done = false,
		onend,
		hintPlan = EMPTY_PLAN,
		onhints,
		instance = $bindable()
	}: {
		card: Component<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
		cardProps?: Record<string, unknown>;
		chips?: Snippet;
		status?: Snippet;
		kindLabel?: string;
		deck?: string | null;
		level?: string | null;
		done?: boolean;
		onend?: () => void;
		/** The hints of the card (#215); none by default. */
		hintPlan?: HintPlan;
		/** Receives the card's hint state (how many hints were used). */
		onhints?: (hints: CardHints) => void;
		instance?: unknown;
	} = $props();

	provideCardFace();
	let bound = $state<CardHints | null>(null);
	$effect(() => {
		if (bound !== null) onhints?.(bound);
	});
	const Card = $derived(card);

	/** The rendered card's instance (its exported functions, e.g. ReverseCard.finish). */
	export function cardInstance(): unknown {
		return instance;
	}
</script>

<StudyFace
	{kindLabel}
	{deck}
	{level}
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
	<HintScope plan={hintPlan} locked={done} bind:hints={bound}>
		<Card bind:this={instance} {...cardProps} />
	</HintScope>
</StudyFace>
