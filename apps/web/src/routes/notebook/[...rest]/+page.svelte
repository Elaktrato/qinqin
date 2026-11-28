<script lang="ts">
	// The mistake notebook (#227) and its round, /notebook and /notebook/practise.
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import { pageTitle } from '$lib/routing/pageTitle';
	import NotebookPage from '$lib/notebook/NotebookPage.svelte';
</script>

<!-- The page's own view sets its title; this one shows until it does. -->
<svelte:head>
	<title>{pageTitle(t('study.notebook.title'))}</title>
</svelte:head>

<NotebookPage rest={page.params.rest ?? ''} />
