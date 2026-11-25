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
	// is open the lookup is pinned: no grace hide, no replacement, and the
	// looked-up word is kept above the sheet (LookupController.keepWordAbove).
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

	// The word stays visible: the text scrolls so the looked-up word sits
	// above the sheet's top edge, when it opens and whenever it grows (a
	// selection's results arrive after it opened). The top is measured from
	// the layout height: the sheet slides in with a translate.
	let content = $state<HTMLElement | null>(null);
	$effect(() => {
		const dialog = content?.closest('dialog');
		if (!dialog) return;
		const keep = (): void => lookup.keepWordAbove(window.innerHeight - dialog.offsetHeight);
		keep();
		if (typeof ResizeObserver !== 'function') return;
		const observer = new ResizeObserver(keep);
		observer.observe(dialog);
		return () => observer.disconnect();
	});
</script>

<Sheet
	open
	label={t('reader.popup.label', { text: frame.text })}
	onclose={() => lookup.close()}
	returnFocus={() => lookup.wordParagraph()}
>
	<div class="lookup-sheet" bind:this={content}>
		<PopupFrameView {frame} {info} {lookup} {studyWorkspaceId} {highlighter} {stateLine} sheet />
	</div>
</Sheet>

<style>
	/* A measuring hook only: the frame lays out as the sheet's own content. */
	.lookup-sheet {
		display: contents;
	}
</style>
