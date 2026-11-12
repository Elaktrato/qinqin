<script lang="ts">
	import { LIBRARY_HREF } from './route';

	// Placeholder: the real reading view replaces this file's content.
	let { id, chapter }: { id: number; chapter: number } = $props();
</script>

<main>
	<p><a href={LIBRARY_HREF}>Back to library</a></p>
	<h1>Book {id}, chapter {chapter}</h1>
</main>
