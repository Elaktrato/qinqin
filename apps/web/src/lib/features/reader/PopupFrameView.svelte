<script lang="ts">
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { hiddenFor } from '$lib/dictionaryVisibility';
	import { workspaces } from '$lib/workspaces';
	import EntryCard from './EntryCard.svelte';
	import HighlightBar from './HighlightBar.svelte';
	import type { HighlightActions } from './highlightUi';
	import { moreLabel } from './entryDisplay';
	import { placePopup } from './placement';
	import { MAX_DEPTH, type PopupFrame } from './popupStackCore';
	import { ENTRIES_VISIBLE, visibleCount } from './showMore';
	import type { LookupController, StackInfo } from './useLookup.svelte';

	// One popup of the stack: a non-modal dialog placed at its frame's
	// anchor, listing the first entries with "show more". Its pointer
	// events go to the controller (grace hide, Shift+hover scanning).
	// `studyWorkspaceId` is the workspace study cards go to (the book's);
	// null hides the add-to-study buttons. `highlighter` adds the
	// highlight action bar to the root popup of a selection in the book
	// (never to hover popups or nested dictionary popups).
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
		/** The word-state line per entry (word highlighting on). */
		stateLine?: ((entryId: number) => string) | null;
	} = $props();

	let popup = $state<HTMLElement | null>(null);
	let width = $state(0);
	// The natural height (content plus padding and border, capped by the
	// stylesheet's 26rem), NOT the rendered one: a popup squeezed to fit one
	// side must still flip to the other side when that one has more room.
	let contentHeight = $state(0);
	let chrome = $state({ edges: 0, cap: Infinity });
	let shown = $state(ENTRIES_VISIBLE);

	const results = $derived(frame.results ?? []);
	const visible = $derived(visibleCount(results.length, 0, shown));
	const hidden = $derived(results.length - visible);
	// The book's workspace decides which dictionaries are hidden, which may
	// differ from the header's current workspace.
	const hiddenIds = $derived(hiddenFor($workspaces.list, studyWorkspaceId, $workspaces.current));
	const isRoot = $derived(frame.depth === 1);
	const hold = (on: boolean) => lookup.hold(on);
	// Result offsets of the root popup are in the paragraph; nested popups
	// look up dictionary text, which has no book sentence.
	const study = $derived(
		studyWorkspaceId === null
			? undefined
			: { workspaceId: studyWorkspaceId, paragraph: isRoot ? info.paragraph || null : null, hold, stateLine }
	);
	const position = $derived(
		placePopup(
			frame.anchor,
			{ width, height: Math.min(contentHeight + chrome.edges, chrome.cap) },
			{
				width: typeof window === 'undefined' ? 0 : window.innerWidth,
				height: typeof window === 'undefined' ? 0 : window.innerHeight
			}
		)
	);

	$effect(() => {
		if (!popup) return;
		const style = getComputedStyle(popup);
		const px = (v: string) => parseFloat(v) || 0;
		chrome = {
			edges: px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth),
			cap: 26 * px(getComputedStyle(document.documentElement).fontSize)
		};
	});
</script>

<div
	bind:this={popup}
	bind:offsetWidth={width}
	class="popup depth-{frame.depth}"
	class:scanning={lookup.popups.shiftHeld && frame.depth < MAX_DEPTH}
	data-lookup-popup
	role="dialog"
	tabindex="-1"
	aria-label={t('reader.popup.label', { text: frame.text })}
	style:left="{position.left}px"
	style:top="{position.top}px"
	style:max-height="min(26rem, {position.maxHeight}px)"
	style:z-index={50 + frame.depth}
	onpointerenter={lookup.popups.enter}
	onpointerleave={lookup.popups.leave}
	onpointermove={(e) => lookup.popups.move(e, frame.id)}
>
	<div class="inner" bind:offsetHeight={contentHeight}>
		<div class="bar">
			{#if isRoot && info.mode === 'selection'}<span class="selected" lang={info.textLang}>{frame.text}</span>{/if}
			<button type="button" class="close" aria-label={t('reader.popup.close')} onclick={() => lookup.closeFrame(frame.id)}>×</button>
		</div>
		{#if isRoot && info.mode === 'selection' && highlighter}<HighlightBar actions={highlighter} />{/if}
		<div class="content" aria-live="polite">
			{#if isRoot && info.note}<p class="note">{info.note}</p>{/if}
			{#if frame.error}
				<p class="error">{frame.error}</p>
			{:else if frame.results === null}
				<p class="hint">{t('reader.popup.lookingUp')}</p>
			{:else if results.length === 0}
				<p class="hint">
					<Msg key="reader.popup.none" args={{ text: frame.text }}
						>{#snippet term(text: string)}<span lang={info.textLang}>{text}</span>{/snippet}</Msg
					>
				</p>
			{:else}
				{#each results.slice(0, visible) as result, i (`${result.entryId}:${result.kind}:${i}`)}
					<EntryCard {result} lang={info.lang} textLang={info.textLang} {study} hidden={hiddenIds} first={isRoot && i === 0} />
				{/each}
				{#if hidden > 0}
					<button type="button" class="more" onclick={() => (shown = visibleCount(results.length, shown))}>
						{moreLabel(hidden, 'entry')}
					</button>
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.popup {
		position: fixed;
		width: max-content;
		max-width: min(26rem, calc(100vw - 16px));
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.35rem 0.8rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 0.5rem;
		background: Canvas;
		color: CanvasText;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
		font-size: 0.9rem;
		line-height: 1.45;
	}

	/* Nested popups: a coloured edge and a deeper shadow per level. */
	.popup:not(.depth-1) {
		border-left: 3px solid color-mix(in srgb, #0b6bcb 55%, transparent);
		box-shadow: 0 10px 32px rgb(0 0 0 / 0.26);
	}

	.depth-3,
	.depth-4 {
		border-left-color: color-mix(in srgb, #8a4fd1 60%, transparent);
	}

	/* Shift held: what Shift+hover can look up stands out. */
	.scanning :global([data-scan]) {
		background: color-mix(in srgb, #0b6bcb 10%, transparent);
	}

	/* Holds its children's margins, so its height is the content's. */
	.inner {
		display: flow-root;
	}

	.bar {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.selected {
		font-size: 0.85rem;
		opacity: 0.75;
	}

	.close {
		margin-left: auto;
		font: inherit;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0.1rem 0.3rem;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.content {
		margin-top: -0.4rem;
	}

	.note,
	.hint,
	.error {
		margin: 0.4rem 0 0;
	}

	.note,
	.hint {
		opacity: 0.75;
	}

	.error {
		color: #b3261e;
	}

	.more {
		margin-top: 0.5rem;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.15rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.3rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
</style>
