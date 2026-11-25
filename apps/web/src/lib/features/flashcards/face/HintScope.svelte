<script lang="ts">
	// One card's hints (#215): creates the CardHints the cards and the session share. Placed inside the
	// card's {#key}, so every card starts with nothing revealed.
	import type { Snippet } from 'svelte';
	import type { EntryPicture } from '$lib/api/images';
	import type { HintPlan } from '$lib/study/hints';
	import { CardHints, provideCardHints } from './cardHints.svelte';

	let {
		plan,
		locked,
		picture = null,
		hints = $bindable(),
		children
	}: {
		plan: HintPlan;
		/** The card's picture (#216), for the picture hint. */
		picture?: EntryPicture | null;
		/** True once the card is answered: the control goes, shown hints stay. */
		locked: boolean;
		/** The state, for the session to read how many hints were used. */
		hints?: CardHints | null;
		children: Snippet;
	} = $props();

	const state = new CardHints(
		() => plan,
		() => locked,
		() => picture
	);
	provideCardHints(state);
	$effect(() => {
		hints = state;
		return () => {
			hints = null;
		};
	});
</script>

{@render children()}
