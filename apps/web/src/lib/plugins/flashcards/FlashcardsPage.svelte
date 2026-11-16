<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import DeckDetail from './decks/DeckDetail.svelte';
	import DeckSettingsView from './decks/DeckSettingsView.svelte';
	import SystemDeckDetail from './decks/SystemDeckDetail.svelte';
	import StarterDeckDetail from './decks/StarterDeckDetail.svelte';
	import DeckList from './decks/DeckList.svelte';
	import { parseDecodedFlashcardsRoute } from './route';

	let { rest }: { rest: string } = $props();

	const route = $derived(parseDecodedFlashcardsRoute(rest));
</script>

<svelte:head>
	<title>{pageTitle('Decks', 'Flashcards')}</title>
</svelte:head>

<!-- A new route is a fresh view: no state leaks between decks. -->
{#key rest}
	{#if route.view === 'deck'}
		<DeckDetail deckId={route.deckId} />
	{:else if route.view === 'settings'}
		<DeckSettingsView deckId={route.deckId} />
	{:else if route.view === 'system-level' || route.view === 'system-plugin'}
		<SystemDeckDetail {route} />
	{:else if route.view === 'system-frequency'}
		<StarterDeckDetail {route} />
	{:else}
		<DeckList />
	{/if}
{/key}
