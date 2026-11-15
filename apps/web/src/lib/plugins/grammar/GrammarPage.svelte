<script lang="ts">
	import GrammarBrowse from './GrammarBrowse.svelte';
	import LessonPage from './LessonView.svelte';
	import PracticeRun from './PracticeRun.svelte';
	import { parseGrammarRoute } from './route';

	let { rest }: { rest: string } = $props();

	const route = $derived(parseGrammarRoute(rest));
</script>

<!-- A new route is a fresh view: no state leaks between lessons. -->
{#key rest}
	{#if route.view === 'practice'}
		<PracticeRun pack={route.pack} lessonId={route.lesson} />
	{:else if route.view === 'lesson'}
		<LessonPage pack={route.pack} lessonId={route.lesson} />
	{:else}
		<GrammarBrowse />
	{/if}
{/key}
