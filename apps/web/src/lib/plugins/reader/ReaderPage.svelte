<script lang="ts">
	import BookView from './BookView.svelte';
	import Library from './Library.svelte';
	import SourceBrowser from './SourceBrowser.svelte';
	import { parseRoute } from './route';

	let { rest }: { rest: string } = $props();

	const route = $derived(parseRoute(rest));
</script>

{#if route.view === 'sources'}
	<SourceBrowser />
{:else if route.view === 'book'}
	<BookView id={route.id} chapter={route.chapter} />
{:else}
	<Library />
{/if}
