<script lang="ts">
	// The courses feature's page: the roadmap or the lesson player, by `rest` (route.ts).
	import { t } from '$lib/i18n';
	import { pageTitle } from '$lib/routing/pageTitle';
	import { parseCourseRoute } from './route';

	let { rest }: { rest: string } = $props();

	const route = $derived(parseCourseRoute(rest));
</script>

<svelte:head>
	<title>{pageTitle(t('features.courses.title'))}</title>
</svelte:head>

{#key rest}
	<div class="page-body">
		<h1>{t('features.courses.title')}</h1>
		{#if route.view !== 'roadmap'}<p></p>{/if}
	</div>
{/key}
