<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { APP_NAME } from '$lib/app';
	import { webPlugins } from '$lib/plugins';
	import { pluginStates } from '$lib/plugins/states';
	import { loadLayout, placeWidgets, resolveLayout } from '$lib/widgets/layout';
	import { allWidgets } from '$lib/widgets/registry';
	import { currentLanguage } from '$lib/workspaces';

	let query = $state('');

	// The user's home layout (null = none stored, so the default). Nothing
	// renders until it is known, so a custom order never flashes as the
	// default first; a failed load falls back to the default quietly.
	let stored = $state<string[] | null>(null);
	let layoutReady = $state(false);

	// Plugin widgets join once the shared plugin states are loaded; until
	// then, or when they failed, only the core widgets can be shown.
	const states = $derived($pluginStates.status === 'ready' ? $pluginStates.list : []);
	const placed = $derived(
		placeWidgets(resolveLayout(stored, allWidgets(webPlugins, states, $currentLanguage), 'home'))
	);
	const hasPlugins = $derived($pluginStates.status === 'ready' || $pluginStates.status === 'error');

	onMount(async () => {
		try {
			stored = await loadLayout();
		} catch {
			stored = null;
		} finally {
			layoutReady = true;
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

	{#if layoutReady}
		{#if placed.length > 0}
			<div class="widgets" data-widget-slot="home">
				{#each placed as { widget, span } (widget.id)}
					{@const Widget = widget.homeComponent ?? widget.component}
					<div class="widget" class:span data-widget={widget.id}>
						<Widget />
					</div>
				{/each}
			</div>
		{:else if hasPlugins}
			<p class="empty">
				Your home page has no widgets. <a href="/settings?tab=home">Choose widgets in Settings</a>.
			</p>
		{/if}
	{/if}
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

	/* One column on phones, two from ~900 px; wide widgets and a normal
	   one without a partner span the row (placeWidgets). */
	.widgets {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 2.5rem 1.25rem;
		margin-top: 2.5rem;
	}

	@media (min-width: 900px) {
		.widgets {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.widget.span {
			grid-column: 1 / -1;
		}
	}

	.widget {
		min-width: 0;
	}

	.empty {
		margin-top: 2.5rem;
		opacity: 0.8;
	}
</style>
