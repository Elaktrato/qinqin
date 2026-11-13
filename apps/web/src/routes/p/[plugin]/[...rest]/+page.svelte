<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { findPlugin, webPlugins } from '$lib/plugins';
	import { loadPluginStates, pluginStates } from '$lib/plugins/states';

	const view = $derived(
		$pluginStates.status === 'ready'
			? findPlugin(page.params.plugin ?? '', webPlugins, $pluginStates.list)?.pages?.[0]
			: undefined
	);

	// A direct page load can mount before the shell has loaded states.
	onMount(() => {
		if ($pluginStates.status === 'idle') void loadPluginStates();
	});
</script>

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
