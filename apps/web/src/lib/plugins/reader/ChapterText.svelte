<script lang="ts">
	import type { Run } from './paragraphText';
	import type { LookupController } from './useLookup.svelte';

	// Renders the chapter as real, selectable text. The markup is the
	// contract dom.ts maps against: <p data-p> per paragraph, one element
	// with data-r per run whose first text node is the displayed run text,
	// furigana (when shown) in an <rt> after it. Runs are written without
	// whitespace between them so no stray spaces enter CJK text.
	let {
		paragraphs,
		showRuby,
		lang,
		lookup,
		marked = new Set<number>(),
		container = $bindable(null)
	}: {
		paragraphs: Run[][];
		showRuby: boolean;
		lang: string;
		lookup: LookupController;
		/** Paragraphs with a bookmark: they get a margin marker. */
		marked?: ReadonlySet<number>;
		container?: HTMLElement | null;
	} = $props();

	// Pointer events are delegated to the container (no per-paragraph
	// listeners). They only enhance plain text, so the container gets no
	// interactive role: keyboard users select text and get the same popup.
	$effect(() => {
		const el = container;
		if (!el) return;
		const options = { passive: true };
		el.addEventListener('pointermove', lookup.pointermove, options);
		el.addEventListener('pointerleave', lookup.pointerleave, options);
		el.addEventListener('pointerdown', lookup.pointerdown, options);
		return () => {
			el.removeEventListener('pointermove', lookup.pointermove);
			el.removeEventListener('pointerleave', lookup.pointerleave);
			el.removeEventListener('pointerdown', lookup.pointerdown);
		};
	});
</script>

<div class="chapter-text" {lang} bind:this={container}>
	{#each paragraphs as runs, p (p)}
		<p data-p={p} class:bookmarked={marked.has(p)}>{#each runs as run, r (r)}{#if run.ruby && showRuby}<ruby data-r={r}>{run.text}<rt>{run.ruby}</rt></ruby>{:else}<span data-r={r}>{run.text}</span>{/if}{/each}</p>
	{/each}
</div>

<style>
	.chapter-text {
		font-size: 1.25rem;
		line-height: 2;
	}

	.chapter-text p {
		position: relative;
		margin: 0 0 1em;
	}

	/* A bookmarked paragraph's margin marker. Decoration only: a
	   pseudo-element without text adds no DOM node (the run mapping in
	   dom.ts stays intact) and nothing for assistive technology; the
	   bookmarks panel is the accessible path. */
	.chapter-text p.bookmarked::before {
		content: '';
		position: absolute;
		inset-inline-start: -0.7rem;
		top: 0.5em;
		width: 0.25rem;
		height: 1em;
		border-radius: 0.125rem;
		background: #0b6bcb;
		pointer-events: none;
	}

	@media (prefers-color-scheme: dark) {
		.chapter-text p.bookmarked::before {
			background: #6cb4ff;
		}
	}

	/* Furigana is a reading aid, not part of the text: copying or
	   selecting a passage leaves it out. */
	rt {
		font-size: 0.55em;
		user-select: none;
	}

	:global(::highlight(reader-lookup)) {
		background-color: color-mix(in srgb, #0b6bcb 22%, transparent);
	}
</style>
