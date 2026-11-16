<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { legacyRedirect } from '$lib/legacyRoutes';
	import { findPlugin, webPlugins } from '$lib/plugins';
	import { loadPluginStates, pluginStates } from '$lib/plugins/states';

	// Flashcards and the reader moved to /flashcards and /reader (v0.4.0):
	// old links land there, and the redirect replaces this history entry.
	const moved = $derived(legacyRedirect(page.url));
	$effect(() => {
		if (moved !== null) void goto(moved, { replaceState: true });
	});

	const view = $derived(
		$pluginStates.status === 'ready' && moved === null
			? findPlugin(page.params.plugin ?? '', webPlugins, $pluginStates.list)?.pages?.[0]
			: undefined
	);

	// A direct page load can mount before the shell has loaded states.
	onMount(() => {
		if ($pluginStates.status === 'idle') void loadPluginStates();
	});
</script>

<svelte:head>
	<title>{pageTitle(view ? '' : 'Plugin')}</title>
</svelte:head>

{#if $pluginStates.status === 'idle' || $pluginStates.status === 'loading'}
	<main><p>Loading…</p></main>
{:else if $pluginStates.status === 'error'}
	<main><p role="alert">Could not load plugins.</p></main>
{:else if view}
	{@const Page = view.component}
	<Page rest={page.params.rest ?? ''} />
{:else}
	<main><p>Plugin not available.</p></main>
{/if}
