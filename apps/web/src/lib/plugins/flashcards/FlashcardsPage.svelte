<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import DeckList from './decks/DeckList.svelte';
	import { parseFlashcardsRoute } from './route';

	let { rest }: { rest: string } = $props();

	const route = $derived(parseFlashcardsRoute(rest));
</script>

<svelte:head>
	<title>{pageTitle('Decks', 'Flashcards')}</title>
</svelte:head>

<!-- A new route is a fresh view: no state leaks between decks. -->
{#key rest}
	{#if route.view === 'deck'}
		<div data-testid="view-deck"></div>
	{:else if route.view === 'settings'}
		<div data-testid="view-settings"></div>
	{:else if route.view === 'system-level' || route.view === 'system-plugin'}
		<div data-testid="view-system"></div>
	{:else}
		<DeckList />
	{/if}
{/key}
