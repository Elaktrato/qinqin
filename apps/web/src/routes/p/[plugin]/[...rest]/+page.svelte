<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api } from '$lib/api/client';
	import type { PluginInfo } from '$lib/api/types';
	import { findPlugin, webPlugins } from '$lib/plugins';

	let pluginStates = $state<PluginInfo[]>([]);
	let loaded = $state(false);

	const plugin = $derived(findPlugin(page.params.plugin ?? '', webPlugins, pluginStates));
	const view = $derived(plugin?.pages?.[0]);

	onMount(async () => {
		try {
			pluginStates = await api<PluginInfo[]>('/api/plugins');
		} catch {
			// Without server state the registry default — enabled — applies.
		}
		loaded = true;
	});
</script>

{#if loaded}
	{#if view}
		{@const Page = view.component}
		<Page rest={page.params.rest ?? ''} />
	{:else}
		<main>
			<p>Plugin not available.</p>
		</main>
	{/if}
{/if}
