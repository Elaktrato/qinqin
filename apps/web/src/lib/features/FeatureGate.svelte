<script lang="ts">
	// What a core feature's page shows: its content while the user's switch is on, a notice when it is off
	// (#199). Switching off hides the page only; nothing is refused or deleted. FeaturePage wraps a feature's
	// component in it; a feature whose pages are routes of their own wraps its layout (Stats, #295).
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import Msg from '$lib/ui/Msg.svelte';
	import { featureEnabled, switchedOffTitle } from './index';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	let { id, children }: { id: string; children: Snippet } = $props();

	const on = $derived(session.features.status === 'ready' && featureEnabled(id, session.features.list));

	// A direct page load can mount before the shell has loaded the states.
	onMount(() => {
		if (session.features.status === 'idle') void session.features.load();
	});
</script>

{#if on}
	{@render children()}
{:else}
	<div class="page-body">
		{#if session.features.status === 'idle' || session.features.status === 'loading'}
			<p class="notice" role="status">{t('app.loading')}</p>
		{:else if session.features.status === 'error'}
			<p class="notice" role="alert">{t('features.switchedOff.loadFailed')}</p>
		{:else}
			<h1>{switchedOffTitle(id)}</h1>
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
