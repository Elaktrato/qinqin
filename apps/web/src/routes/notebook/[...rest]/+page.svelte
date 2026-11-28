<script lang="ts">
	// The mistake notebook (#227) and its round, /notebook and /notebook/practise.
	import { page } from '$app/state';
	import NotebookPage from '$lib/notebook/NotebookPage.svelte';
</script>

<NotebookPage rest={page.params.rest ?? ''} />
