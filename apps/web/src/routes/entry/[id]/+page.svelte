<script lang="ts">
	import { page } from '$app/state';
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import EntryView from '$lib/entry/EntryView.svelte';
	import { setFrameTitle } from '$lib/frame/pageFrame.svelte';

	function parseEntryId(raw: string | undefined): number | null {
		if (!raw || !/^\d+$/.test(raw)) return null;
		const id = Number(raw);
		return Number.isSafeInteger(id) && id > 0 ? id : null;
	}

	const entryId = $derived(parseEntryId(page.params.id));
	let written = $state('');
	setFrameTitle(() => (entryId === null ? '' : `#${entryId}`));
</script>

<svelte:head>
	<title>{pageTitle(written || t('entry.page.notFound'))}</title>
</svelte:head>

<div class="page-body entry-page">
	<EntryView {entryId} headingLevel={1} recordView={true} ontitle={(w) => (written = w)} />
</div>
