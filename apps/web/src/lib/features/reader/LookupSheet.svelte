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
	// The sheet takes at most 55 % of the screen (#282; the other sheets keep
	// Sheet's 85 %), so the text being read stays in view; a long entry
	// scrolls inside it.
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

	const LOOKUP_SHEET_MAX_HEIGHT = '55dvh';

	$effect(() => {
		lookup.hold(true);
		return () => lookup.hold(false);
	});

	// The word stays visible: the text scrolls so the looked-up word sits
	// above the sheet's top edge, when it opens and whenever it or the
	// viewport changes size (a selection's results arrive after it opened;
	// the keyboard closes in the WebView). The top is measured from the
	// layout height: the sheet slides in with a translate. While it is open
	// the page gets as much room under its end (--lookup-sheet-space, the
	// panel's bottom padding in routes/+layout.svelte), so a word on the last
	// line can scroll above the sheet too.
	let content = $state<HTMLElement | null>(null);
	$effect(() => {
		const dialog = content?.closest('dialog');
		if (!dialog) return;
		const root = document.documentElement;
		const keep = (): void => {
			root.style.setProperty('--lookup-sheet-space', `${dialog.offsetHeight}px`);
			lookup.keepWordAbove(window.innerHeight - dialog.offsetHeight);
		};
		keep();
		const visual = window.visualViewport;
		window.addEventListener('resize', keep);
		visual?.addEventListener('resize', keep);
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(keep) : null;
		observer?.observe(dialog);
		return () => {
			observer?.disconnect();
			window.removeEventListener('resize', keep);
			visual?.removeEventListener('resize', keep);
			root.style.removeProperty('--lookup-sheet-space');
		};
	});
</script>

<Sheet
	open
	label={t('reader.popup.label', { text: frame.text })}
	onclose={() => lookup.close()}
	returnFocus={() => lookup.wordParagraph()}
	maxHeight={LOOKUP_SHEET_MAX_HEIGHT}
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
