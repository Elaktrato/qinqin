<script lang="ts">
	// The courses feature's page (#222): the roadmap or the lesson player, by `rest` (route.ts). A new route or
	// workspace is a new view: nothing of one lesson leaks into the next. On a fresh load the workspaces arrive after
	// the page mounts, so the views wait for the current workspace.
	import { useSession } from '$lib/context/context';
	import { t } from '$lib/i18n';
	import { pageTitle } from '$lib/routing/pageTitle';
	import LessonPlayer from './LessonPlayer.svelte';
	import Roadmap from './Roadmap.svelte';
	import { parseCourseRoute } from './route';

	let { rest }: { rest: string } = $props();

	const session = useSession();
	const route = $derived(parseCourseRoute(rest));
	const workspace = $derived(session.workspaces.current);
</script>

<!-- The roadmap and the player set their own titles; this one shows until they do. -->
<svelte:head>
	<title>{pageTitle(t('features.courses.title'))}</title>
</svelte:head>

{#if workspace === null && !session.workspaces.loaded}
	<div class="page-body">
		<h1>{t('features.courses.title')}</h1>
		<p role="status">{t('common.loading')}</p>
	</div>
{:else}
	{#key `${workspace?.id ?? 0}:${rest}`}
		{#if route.view === 'roadmap'}
			<Roadmap courseId={route.course} />
		{:else}
			<LessonPlayer {route} />
		{/if}
	{/key}
{/if}
