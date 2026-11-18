<script lang="ts">
	import { t } from '$lib/i18n';
	import { Sheet } from '$lib/ui';
	import PopupFrameView from './PopupFrameView.svelte';
	import type { HighlightActions } from './highlightUi';
	import type { PopupFrame } from './popupStackCore';
	import type { LookupController, StackInfo } from './useLookup.svelte';

	// The lookup on the phone (design §9, §10): the root popup's content in
	// the shared bottom Sheet (lib/ui, which the journal's corrections reuse),
	// named by the looked-up text. Closing the sheet (its close button,
	// Escape, a drag down, a tap on the backdrop) closes the lookup. While it
	// is open the lookup is pinned: no grace hide, no replacement.
	let {
		frame,
		info,
		lookup,
		studyWorkspaceId,
		highlighter = null,
		stateLine = null
	}: {
		frame: PopupFrame;
		info: StackInfo;
		lookup: LookupController;
		studyWorkspaceId: number | null;
		highlighter?: HighlightActions | null;
		stateLine?: ((entryId: number) => string) | null;
	} = $props();

	$effect(() => {
		lookup.hold(true);
		return () => lookup.hold(false);
	});
</script>

<Sheet open label={t('reader.popup.label', { text: frame.text })} onclose={() => lookup.close()}>
	<PopupFrameView {frame} {info} {lookup} {studyWorkspaceId} {highlighter} {stateLine} sheet />
</Sheet>
