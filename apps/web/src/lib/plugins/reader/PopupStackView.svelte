<script lang="ts">
	import PopupFrameView from './PopupFrameView.svelte';
	import type { LookupController } from './useLookup.svelte';

	// The lookup popups, root first: each nested popup was opened by
	// Shift+hover inside the one before it and sits above it (z-index by
	// depth). Keyed by frame id, so a replaced child is a new popup with its
	// own "show more" state.
	let { lookup }: { lookup: LookupController } = $props();
</script>

{#if lookup.info}
	{#each lookup.stack.frames as frame (frame.id)}
		<PopupFrameView {frame} info={lookup.info} {lookup} />
	{/each}
{/if}
