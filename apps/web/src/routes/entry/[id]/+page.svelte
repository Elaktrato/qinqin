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
	// The written form and load state belong to one id: a navigation to
	// another entry never shows the previous word (a stale title) or its
	// "not found" answer.
	let loaded = $state<{ id: number | null; written: string }>({ id: null, written: '' });
	let status = $state<{ id: number | null; state: 'loading' | 'ready' | 'notfound' | 'error' }>({
		id: null,
		state: 'loading'
	});
	const written = $derived(loaded.id === entryId ? loaded.written : '');
	const loadState = $derived(status.id === entryId ? status.state : 'loading');
	const notFound = $derived(loadState === 'notfound');
	setFrameTitle(() => written);
</script>

<svelte:head>
	<title>{pageTitle(notFound ? t('entry.page.notFound') : written)}</title>
</svelte:head>

<div class="page-body entry-page">
	<EntryView
		{entryId}
		headingLevel={1}
		recordView={true}
		ontitle={(w) => {
			if (entryId !== null) loaded = { id: entryId, written: w };
		}}
		onstate={(s) => {
			status = { id: entryId, state: s };
		}}
	/>
</div>
