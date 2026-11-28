<script lang="ts">
	import { pageTitle } from '$lib/routing/pageTitle';
	import GrammarBrowse from './GrammarBrowse.svelte';
	import LessonPage from './LessonView.svelte';
	import PracticeRun from './PracticeRun.svelte';
	import ReviewRound from './review/ReviewRound.svelte';
	import { parseGrammarRoute } from './route';

	let { rest }: { rest: string } = $props();

	const route = $derived(parseGrammarRoute(rest));
</script>

<svelte:head>
	<title>{pageTitle(route.view === 'practice' ? 'Practice' : route.view === 'lesson' ? 'Lesson' : route.view === 'review' ? 'Review' : '', 'Grammar')}</title>
</svelte:head>

<!-- A new route is a fresh view: no state leaks between lessons. -->
{#key rest}
	{#if route.view === 'review'}
		<ReviewRound />
	{:else if route.view === 'practice'}
		<PracticeRun pack={route.pack} lessonId={route.lesson} />
	{:else if route.view === 'lesson'}
		<LessonPage pack={route.pack} lessonId={route.lesson} />
	{:else}
		<GrammarBrowse />
	{/if}
{/key}
