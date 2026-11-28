<script lang="ts">
	import { pageTitle } from '$lib/routing/pageTitle';
	import BookView from './BookView.svelte';
	import Library from './Library.svelte';
	import SourceBrowser from './SourceBrowser.svelte';
	import { page } from '$app/state';
	import { parseAt, parseRoute } from './route';

	let { rest }: { rest: string } = $props();

	const route = $derived(parseRoute(rest));
	// A saved sentence's link (#280): the word's place in the chapter.
	const at = $derived(parseAt(page.url.searchParams.get('at')));
</script>

<svelte:head>
	<title>{pageTitle(route.view === 'book' ? 'Book' : route.view === 'sources' ? 'Sources' : '', 'Reader')}</title>
</svelte:head>

{#if route.view === 'sources'}
	<SourceBrowser />
{:else if route.view === 'book'}
	<BookView id={route.id} chapter={route.chapter} {at} />
{:else}
	<Library />
{/if}
