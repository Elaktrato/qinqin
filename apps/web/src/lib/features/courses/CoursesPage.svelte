<script lang="ts">
	// The courses feature's page (#222): the roadmap or the lesson player, by `rest` (route.ts). A new route is a new
	// view: nothing of one lesson leaks into the next.
	import LessonPlayer from './LessonPlayer.svelte';
	import Roadmap from './Roadmap.svelte';
	import { parseCourseRoute } from './route';

	let { rest }: { rest: string } = $props();

	const route = $derived(parseCourseRoute(rest));
</script>

{#key rest}
	{#if route.view === 'roadmap'}
		<Roadmap courseId={route.course} />
	{:else}
		<LessonPlayer {route} />
	{/if}
{/key}
