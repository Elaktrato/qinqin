<script lang="ts">
	// The page of a core feature at /flashcards or /reader: the feature itself
	// while the user's switch is on, a notice when it is off. Switching off
	// hides the page only; nothing is refused or deleted. The route sets the
	// fallback title; the feature's own views set theirs.
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { featureEnabled, switchedOffTitle, type CoreFeature } from './index';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	let { feature, rest }: { feature: Pick<CoreFeature, 'id' | 'title' | 'component'>; rest: string } =
		$props();

	const on = $derived(session.plugins.status === 'ready' && featureEnabled(feature.id, session.plugins.list));

	// A direct page load can mount before the shell has loaded the states.
	onMount(() => {
		if (session.plugins.status === 'idle') void session.plugins.load();
	});
</script>

{#if on}
	{@const Page = feature.component}
	<Page {rest} />
{:else}
	<div class="page-body">
		{#if session.plugins.status === 'idle' || session.plugins.status === 'loading'}
			<p class="notice" role="status">{t('app.loading')}</p>
		{:else if session.plugins.status === 'error'}
			<p class="notice" role="alert">{t('features.switchedOff.loadFailed')}</p>
		{:else}
			<h1>{switchedOffTitle(feature.id)}</h1>
			<p class="notice">
				<Msg key="features.switchedOff.text">{#snippet link(text: string)}<a href="/settings?tab=features">{text}</a>{/snippet}</Msg>
			</p>
		{/if}
	</div>
{/if}

<style>
	/* A notice, not a page: muted running text; the link stays recognisable
	   without colour (design §5, #106). */
	.notice {
		margin: 0;
		color: var(--readable-muted);
	}
	.notice a {
		color: var(--reading-accent);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
	@media (forced-colors: active) {
		.notice a {
			color: LinkText;
		}
	}
</style>
