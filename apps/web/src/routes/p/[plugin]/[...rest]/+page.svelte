<script lang="ts">
	import { t } from '$lib/i18n';
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
	<title>{pageTitle(view ? '' : t('app.plugin.title'))}</title>
</svelte:head>

{#if $pluginStates.status === 'idle' || $pluginStates.status === 'loading'}
	<div class="page-body"><p class="notice">{t('app.plugin.loading')}</p></div>
{:else if $pluginStates.status === 'error'}
	<div class="page-body"><p class="notice" role="alert">{t('app.plugin.loadFailed')}</p></div>
{:else if view}
	{@const Page = view.component}
	<Page rest={page.params.rest ?? ''} />
{:else if moved === null}
	<!-- A moved core page redirects first: never flash "not available" (#106, R1). -->
	<div class="page-body"><p class="notice">{t('app.plugin.unavailable')}</p></div>
{/if}

<style>
	/* The shell's own states are plain muted text (#106); the error keeps its
	   role and reads as an error. */
	.notice {
		margin: 0;
		color: var(--readable-muted);
	}
	.notice[role='alert'] {
		color: var(--readable-bad);
	}
</style>
