<script lang="ts">
	// The page of a core feature at /flashcards or /reader: the feature itself
	// while the user's switch is on, a notice when it is off. Switching off
	// hides the page only; nothing is refused or deleted. The route sets the
	// fallback title; the feature's own views set theirs.
	import { onMount } from 'svelte';
	import { loadPluginStates, pluginStates } from '$lib/plugins/states';
	import { featureEnabled, type CoreFeature } from './index';

	let { feature, rest }: { feature: Pick<CoreFeature, 'id' | 'title' | 'label' | 'verb' | 'component'>; rest: string } =
		$props();

	const on = $derived($pluginStates.status === 'ready' && featureEnabled(feature.id, $pluginStates.list));

	// A direct page load can mount before the shell has loaded the states.
	onMount(() => {
		if ($pluginStates.status === 'idle') void loadPluginStates();
	});
</script>

{#if on}
	{@const Page = feature.component}
	<Page {rest} />
{:else}
	<main>
		{#if $pluginStates.status === 'idle' || $pluginStates.status === 'loading'}
			<p role="status">Loading…</p>
		{:else if $pluginStates.status === 'error'}
			<p role="alert">Could not load your settings. Reload the page to try again.</p>
		{:else}
			<h1>{feature.label} {feature.verb} switched off</h1>
			<p>You switched this off for yourself. Turn it back on in <a href="/settings?tab=features">Settings → Features</a>.</p>
		{/if}
	</main>
{/if}
