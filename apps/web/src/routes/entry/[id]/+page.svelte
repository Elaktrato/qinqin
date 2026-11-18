<script lang="ts">
	import { page } from '$app/state';
	import EntryView from '$lib/entry/EntryView.svelte';
	import { setFrameTitle } from '$lib/frame/pageFrame.svelte';

	function parseEntryId(raw: string | undefined): number | null {
		if (!raw || !/^\d+$/.test(raw)) return null;
		const id = Number(raw);
		return Number.isSafeInteger(id) && id > 0 ? id : null;
	}

	const entryId = $derived(parseEntryId(page.params.id));
	setFrameTitle(() => (entryId === null ? '' : `#${entryId}`));
</script>

<div class="page-body entry-page">
	<EntryView {entryId} headingLevel={1} recordView={true} />
</div>
