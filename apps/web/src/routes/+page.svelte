<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api/client';
	import type { PluginInfo } from '$lib/api/types';
	import { APP_NAME } from '$lib/app';
	import ActivityHeatmap from '$lib/components/ActivityHeatmap.svelte';
	import { homeWidgets, webPlugins } from '$lib/plugins';

	let query = $state('');
	let pluginStates = $state<PluginInfo[]>([]);

	// Only the installed, enabled plugins this build can render get a
	// slot; unknown or disabled plugins simply do not appear, and the
	// rest follow the user's Settings order.
	const plugins = $derived(homeWidgets(webPlugins, pluginStates));

	onMount(async () => {
		try {
			pluginStates = await api<PluginInfo[]>('/api/plugins');
		} catch {
			// Without server state the registry default — enabled —
			// keeps the home page useful.
		}
	});

	async function search(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		await goto(`/search?q=${encodeURIComponent(query.trim())}`);
	}
</script>

<main class="home">
	<h1>{APP_NAME}</h1>

	<form class="search" role="search" onsubmit={search}>
		<input
			name="q"
			type="search"
			bind:value={query}
			aria-label="Search entries"
			placeholder="Search entries…"
		/>
		<button type="submit">Search</button>
	</form>

	<ActivityHeatmap />

	<section class="plugin-slot" data-plugin-slot="home" aria-label="Home widgets">
		{#each plugins as plugin (plugin.manifest.id)}
			{@const Widget = plugin.component}
			{#if Widget}
				<Widget />
			{/if}
		{/each}
	</section>
</main>

<style>
	.home h1 {
		margin-bottom: 1.5rem;
	}

	.search {
		display: flex;
		gap: 0.5rem;
		max-width: 32rem;
	}

	.search input {
		flex: 1;
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.search button {
		font: inherit;
		font-weight: 600;
		padding: 0.6rem 1rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		cursor: pointer;
	}

	.plugin-slot:empty {
		display: none;
	}
</style>
