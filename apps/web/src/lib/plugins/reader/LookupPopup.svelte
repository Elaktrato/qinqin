<script module lang="ts">
	import { getEntry } from '$lib/api/entries';
	import { cachedLoader } from './lruCache';

	// The most recent entries looked up during this visit; a failed fetch
	// is forgotten so it is retried next time.
	const loadEntry = cachedLoader(getEntry, 200);
</script>

<script lang="ts">
	import type { Entry, SegmentMatch } from '$lib/api/types';
	import Badges from '$lib/components/Badges.svelte';
	import Readings from '$lib/components/Readings.svelte';
	import Senses from '$lib/components/Senses.svelte';
	import { apiErrorMessage } from './errors';
	import { homophoneNote, preferredEntry, type LookupKind } from './lookup';

	let {
		lang,
		mode,
		match,
		text,
		kind,
		note = '',
		error = '',
		anchor,
		onclose
	}: {
		lang: string;
		mode: 'hover' | 'selection';
		/** undefined while resolving; null when the tokenizer found nothing. */
		match: SegmentMatch | null | undefined;
		text: string;
		kind: LookupKind;
		note?: string;
		error?: string;
		anchor: DOMRect | { x: number; y: number };
		onclose: () => void;
	} = $props();

	const GAP = 6;
	const MARGIN = 8;

	const choice = $derived(match ? preferredEntry(match, kind) : undefined);
	const homophones = $derived(match ? homophoneNote(match, kind) : null);
	// A primitive, so re-anchoring the same lookup never refetches.
	const choiceId = $derived(choice?.id);
	let entry = $state<Entry | null>(null);
	let entryError = $state('');
	let width = $state(0);
	let height = $state(0);

	$effect(() => {
		const id = choiceId;
		entry = null;
		entryError = '';
		if (id === undefined) return;
		let current = true;
		loadEntry(id).then(
			(loaded) => current && (entry = loaded),
			(err) => current && (entryError = apiErrorMessage(err, 'lookup'))
		);
		return () => {
			current = false;
		};
	});

	// Below the word, flipped above when it would leave the viewport, and
	// clamped inside it horizontally.
	const position = $derived.by(() => {
		const rect =
			'left' in anchor
				? anchor
				: { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
		const vw = typeof window === 'undefined' ? 0 : window.innerWidth;
		const vh = typeof window === 'undefined' ? 0 : window.innerHeight;
		const left = Math.max(MARGIN, Math.min(rect.left, vw - width - MARGIN));
		let top = rect.bottom + GAP;
		if (top + height > vh - MARGIN && rect.top - GAP - height >= MARGIN) top = rect.top - GAP - height;
		return { left, top: Math.max(MARGIN, top) };
	});

	// The header shows what the reader sees; below it the dictionary form
	// when it differs: the lemma of an inflected word ("食べる (past)"), or
	// the entry's script when the text is shown in another variant.
	const surface = $derived(match?.surface ?? text);
	const dictionaryForm = $derived.by(() => {
		if (match?.reason) return `${match.lemma} (${match.reason})`;
		if (entry && entry.written !== surface) return entry.written;
		return '';
	});
</script>

<!-- Hover popups are tooltips the pointer passes through; a selection
     popup is a sticky, interactive (non-modal) dialog. -->
<div
	bind:clientWidth={width}
	bind:clientHeight={height}
	class="popup"
	class:hover={mode === 'hover'}
	data-lookup-popup
	role={mode === 'hover' ? 'tooltip' : 'dialog'}
	aria-label={mode === 'hover' ? undefined : `Dictionary: ${text}`}
	style:left="{position.left}px"
	style:top="{position.top}px"
>
	<div class="content" aria-live="polite">
		<header>
			<span class="written" {lang}>{surface}</span>
			{#if dictionaryForm}<span class="lemma" {lang}>{dictionaryForm}</span>{/if}
			{#if mode === 'selection'}
				<button type="button" class="close" aria-label="Close" onclick={onclose}>×</button>
			{/if}
		</header>
		{#if note}<p class="note">{note}</p>{/if}
		<!-- Right under the header: a hover popup clips its overflow. -->
		{#if homophones && !error}
			<p class="hint homophones"><a href={homophones.href}>{homophones.text}</a></p>
		{/if}

		{#if error}
			<p class="error">{error}</p>
		{:else if match === undefined}
			<p class="hint">Looking up…</p>
		{:else if !choice}
			<p class="hint">No dictionary entry found for <span {lang}>{text}</span>.</p>
		{:else if entryError}
			<p class="error">{entryError}</p>
		{:else if !entry}
			<p class="hint">Loading entry…</p>
		{:else}
			<Readings readings={entry.readings} />
			<Badges badges={entry.badges} />
			<Senses senses={entry.senses} />
			{#if mode === 'selection'}
				<p class="more"><a href={`/entry/${entry.id}`}>Open full entry</a></p>
			{/if}
		{/if}
	</div>
</div>

<style>
	.popup {
		position: fixed;
		z-index: 50;
		width: max-content;
		max-width: min(24rem, calc(100vw - 16px));
		max-height: min(22rem, calc(100vh - 16px));
		overflow-y: auto;
		padding: 0.6rem 0.8rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 0.5rem;
		background: Canvas;
		color: CanvasText;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
		font-size: 0.9rem;
		line-height: 1.4;
	}

	/* A hover popup never takes the pointer from the text under it. */
	.hover {
		pointer-events: none;
		overflow: hidden;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.written {
		font-size: 1.6rem;
		font-weight: 600;
	}

	.lemma {
		opacity: 0.8;
	}

	.close {
		margin-left: auto;
		font: inherit;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0.1rem 0.4rem;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.note,
	.hint,
	.error,
	.more {
		margin: 0.4rem 0 0;
	}

	.note,
	.hint {
		opacity: 0.75;
	}

	.error {
		color: #b3261e;
	}

	/* The shared entry sections, made compact for a popup. */
	.content :global(.readings),
	.content :global(.badges),
	.content :global(.senses) {
		margin-top: 0.5rem;
	}

	.content :global(h2) {
		display: none;
	}

	.content :global(.readings ul),
	.content :global(.badges ul) {
		margin-top: 0;
	}

	.content :global(.readings li) {
		font-size: 0.95rem;
	}

	.content :global(.dictionary h3) {
		font-size: 0.8rem;
		margin-top: 0.25rem;
		opacity: 0.75;
	}
</style>
