<script lang="ts">
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { hiddenFor } from '$lib/workspace/dictionaryVisibility';
	import EntryCard from './EntryCard.svelte';
	import { IconButton } from '$lib/ui';
	import HighlightBar from './HighlightBar.svelte';
	import type { HighlightActions } from './highlightUi';
	import { moreLabel } from './entryDisplay';
	import { placePopup } from './placement';
	import { MAX_DEPTH, type PopupFrame } from './popupStackCore';
	import { ENTRIES_VISIBLE, visibleCount } from './showMore';
	import type { LookupController, StackInfo } from './useLookup.svelte';
	import { useSession } from '$lib/context/context';
	const session = useSession();

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
		stateLine = null,
		sheet = false
	}: {
		frame: PopupFrame;
		info: StackInfo;
		lookup: LookupController;
		studyWorkspaceId: number | null;
		highlighter?: HighlightActions | null;
		/** The word-state line per entry (word highlighting on). */
		stateLine?: ((entryId: number) => string) | null;
		/** Inside the phone's LookupSheet: no placement, no close button (the sheet has one), no pointer scanning. */
		sheet?: boolean;
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
	const hiddenIds = $derived(hiddenFor(session.workspaces.list, studyWorkspaceId, session.workspaces.current));
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

{#snippet content()}
	<div class="inner" bind:offsetHeight={contentHeight}>
		{#if !sheet || (isRoot && info.mode === 'selection')}
		<div class="bar">
			{#if isRoot && info.mode === 'selection'}<span class="selected" lang={info.textLang}>{frame.text}</span>{/if}
			{#if !sheet}<span class="close"
					><IconButton label={t('reader.popup.close')} icon="close" size="s" placement="start" onclick={() => lookup.closeFrame(frame.id)} /></span
				>{/if}
		</div>
		{/if}
		{#if isRoot && info.mode === 'selection' && highlighter}<HighlightBar actions={highlighter} live={sheet} />{/if}
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
{/snippet}

{#if sheet}
	<div class="in-sheet" data-lookup-popup>{@render content()}</div>
{:else}
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
		{@render content()}
	</div>
{/if}

<style>
	/* The lookup popup (design §9 "Reader"): a floating layer below the word
	   (placePopup; above only when there is no room below), entries
	   separated by hairlines. */
	.popup {
		position: fixed;
		width: 18.75rem;
		max-width: calc(100vw - 16px);
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-1) var(--space-4) var(--space-2);
		border: 1px solid var(--hair);
		border-radius: var(--radius-large);
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-float);
		font-size: var(--font-size-s);
		line-height: var(--line-body);
		animation: popup-in var(--motion-fast) var(--ease-standard);
	}

	@keyframes popup-in {
		from {
			opacity: 0;
		}
	}

	/* Nested popups (Shift+hover): an accent line at the start edge, a shape
	   that says "opened from the one below". */
	.popup:not(.depth-1) {
		border-inline-start: 3px solid var(--accent);
	}

	/* Shift held: what Shift+hover can look up stands out. */
	.scanning :global([data-scan]) {
		background: var(--selected-wash);
	}

	/* Holds its children's margins, so its height is the content's. */
	.inner {
		display: flow-root;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2rem;
	}

	.selected {
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
	}

	.close {
		display: inline-flex;
		margin-inline-start: auto;
		margin-inline-end: calc(-1 * var(--space-2));
	}

	.note,
	.hint,
	.error {
		margin: var(--space-2) 0;
	}

	.note,
	.hint {
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.more {
		margin: var(--space-1) 0 var(--space-2);
		padding: 0;
		border: none;
		background: none;
		color: var(--reading-accent);
		font: inherit;
		font-size: var(--font-size-xs);
		text-decoration: underline;
		cursor: pointer;
	}

	@media (forced-colors: active) {
		.popup {
			border-color: CanvasText;
		}
		.popup:not(.depth-1) {
			border-inline-start-color: Highlight;
		}
	}
</style>
