<script lang="ts">
	import { PHONE_MEDIA_QUERY } from '$lib/frame/breakpoint';
	import LookupSheet from './LookupSheet.svelte';
	import PopupFrameView from './PopupFrameView.svelte';
	import type { HighlightActions } from './highlightUi';
	import type { LookupController } from './useLookup.svelte';

	// The lookup popups, root first: each nested popup was opened by
	// Shift+hover inside the one before it and sits above it (z-index by
	// depth). Keyed by frame id, so a replaced child is a new popup with its
	// own "show more" state. On the phone frame (lib/frame/breakpoint.ts) the
	// root frame is a bottom sheet instead (LookupSheet); nested frames need
	// a mouse and keep the popup path.
	let {
		lookup,
		studyWorkspaceId = null,
		highlighter = null,
		stateLine = null
	}: {
		lookup: LookupController;
		studyWorkspaceId?: number | null;
		highlighter?: HighlightActions | null;
		stateLine?: ((entryId: number) => string) | null;
	} = $props();

	let phone = $state(typeof matchMedia === 'function' && matchMedia(PHONE_MEDIA_QUERY).matches);
	$effect(() => {
		if (typeof matchMedia !== 'function') return;
		const query = matchMedia(PHONE_MEDIA_QUERY);
		phone = query.matches;
		const change = (e: { matches: boolean }): void => void (phone = e.matches);
		query.addEventListener('change', change);
		return () => query.removeEventListener('change', change);
	});
</script>

{#if lookup.info}
	{#each lookup.stack.frames as frame (frame.id)}
		{#if phone && frame.depth === 1}
			<LookupSheet {frame} info={lookup.info} {lookup} {studyWorkspaceId} {highlighter} {stateLine} />
		{:else}
			<PopupFrameView {frame} info={lookup.info} {lookup} {studyWorkspaceId} {highlighter} {stateLine} />
		{/if}
	{/each}
{/if}
