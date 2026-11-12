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
		container = $bindable(null)
	}: {
		paragraphs: Run[][];
		showRuby: boolean;
		lang: string;
		lookup: LookupController;
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
		<p data-p={p}>{#each runs as run, r (r)}{#if run.ruby && showRuby}<ruby data-r={r}>{run.text}<rt>{run.ruby}</rt></ruby>{:else}<span data-r={r}>{run.text}</span>{/if}{/each}</p>
	{/each}
</div>

<style>
	.chapter-text {
		font-size: 1.25rem;
		line-height: 2;
	}

	.chapter-text p {
		margin: 0 0 1em;
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
