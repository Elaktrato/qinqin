<script lang="ts">
	// The page of a core feature at /flashcards or /reader: the feature itself
	// while the user's switch is on, a notice when it is off. Switching off
	// hides the page only; nothing is refused or deleted. The route sets the
	// fallback title; the feature's own views set theirs.
	import { onMount } from 'svelte';
	import { loadPluginStates, pluginStates } from '$lib/plugins/states';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { featureEnabled, switchedOffTitle, type CoreFeature } from './index';

	let { feature, rest }: { feature: Pick<CoreFeature, 'id' | 'title' | 'component'>; rest: string } =
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
			<p role="status">{t('app.loading')}</p>
		{:else if $pluginStates.status === 'error'}
			<p role="alert">{t('features.switchedOff.loadFailed')}</p>
		{:else}
			<h1>{switchedOffTitle(feature.id)}</h1>
			<p>
				<Msg key="features.switchedOff.text">{#snippet link(text: string)}<a href="/settings?tab=features">{text}</a>{/snippet}</Msg>
			</p>
		{/if}
	</main>
{/if}
