<script lang="ts">
	import { groupSegsByRun, type RunPiece } from './highlightUi';
	import { splitRunsByHighlights, type Highlight } from './highlights';
	import type { Run } from './paragraphText';
	import type { LookupController } from './useLookup.svelte';

	// Renders the chapter as real, selectable text. The markup is the
	// contract dom.ts maps against: <p data-p> per paragraph, one element
	// with data-r per run whose first text node is the displayed run text,
	// furigana (when shown) in an <rt> after it. A paragraph with
	// highlights cuts its runs into pieces instead (<span>/<mark> with
	// data-o, the piece's UTF-16 start in its run), all inside the run's
	// element and before its <rt>. Runs are written without whitespace
	// between them so no stray spaces enter CJK text.
	let {
		paragraphs,
		showRuby,
		lang,
		lookup,
		marked = new Set<number>(),
		highlights = new Map<number, Highlight[]>(),
		onhighlight,
		container = $bindable(null)
	}: {
		paragraphs: Run[][];
		showRuby: boolean;
		lang: string;
		lookup: LookupController;
		/** Paragraphs with a bookmark: they get a margin marker. */
		marked?: ReadonlySet<number>;
		/** The highlights to draw, per paragraph (visibleHighlights' `drawn`). */
		highlights?: ReadonlyMap<number, Highlight[]>;
		/** A highlight was clicked (or Enter pressed on a focused one). */
		onhighlight?: (id: number, mark: HTMLElement) => void;
		container?: HTMLElement | null;
	} = $props();

	function piecesOf(runs: Run[], drawn: Highlight[]): ReturnType<typeof groupSegsByRun> {
		return groupSegsByRun(splitRunsByHighlights(runs, drawn), runs.length);
	}

	// A click on a highlight edits it; a click that ended a selection (a
	// drag, a double click) is the selection lookup's, not ours.
	$effect(() => {
		const el = container;
		const open = onhighlight;
		if (!el || !open) return;
		const markOf = (target: EventTarget | null) =>
			target instanceof Element ? target.closest<HTMLElement>('mark[data-h]') : null;
		const onClick = (e: MouseEvent): void => {
			const mark = markOf(e.target);
			if (!mark || e.button !== 0 || e.detail > 1) return;
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed) return;
			open(Number(mark.dataset.h), mark);
		};
		const onKey = (e: KeyboardEvent): void => {
			const mark = markOf(e.target);
			if (!mark || e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
			e.preventDefault();
			open(Number(mark.dataset.h), mark);
		};
		el.addEventListener('click', onClick);
		el.addEventListener('keydown', onKey);
		return () => {
			el.removeEventListener('click', onClick);
			el.removeEventListener('keydown', onKey);
		};
	});

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

{#snippet piece(s: RunPiece)}{#if s.highlight}<mark data-o={s.startInRun} data-h={s.highlight.id} class="hl {s.highlight.color}" class:noted={s.noteMark}>{s.text}</mark>{:else}<span data-o={s.startInRun}>{s.text}</span>{/if}{/snippet}

<div class="chapter-text" {lang} bind:this={container}>
	{#each paragraphs as runs, p (p)}
		{@const drawn = highlights.get(p)}
		<!-- One <p> per paragraph whatever its content: the position observers watch these elements. -->
		<p data-p={p} class:bookmarked={marked.has(p)}>{#if drawn && drawn.length > 0}{#each piecesOf(runs, drawn) as g (g.run)}{#if g.ruby && showRuby}<ruby data-r={g.run}>{#each g.segs as s (s.startInRun)}{@render piece(s)}{/each}<rt>{g.ruby}</rt></ruby>{:else}<span data-r={g.run}>{#each g.segs as s (s.startInRun)}{@render piece(s)}{/each}</span>{/if}{/each}{:else}{#each runs as run, r (r)}{#if run.ruby && showRuby}<ruby data-r={r}>{run.text}<rt>{run.ruby}</rt></ruby>{:else}<span data-r={r}>{run.text}</span>{/if}{/each}{/if}</p>
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

	/* Highlights: a light tint under dark text, a deep one under light
	   text in dark mode (both well above 4.5:1). Decoration only for
	   assistive technology: the Highlights panel is the accessible path. */
	mark.hl {
		color: inherit;
		border-radius: 0.15em;
		cursor: pointer;
	}

	mark.yellow {
		background: #fff1a6;
	}

	mark.green {
		background: #cdf0c9;
	}

	mark.blue {
		background: #cfe3ff;
	}

	mark.pink {
		background: #ffd6e8;
	}

	/* A highlight with a note: a small dot after its last character. A
	   pseudo-element adds no DOM node, so the run mapping stays intact. */
	mark.noted::after {
		content: '';
		display: inline-block;
		width: 0.38em;
		height: 0.38em;
		margin-inline-start: 0.08em;
		vertical-align: super;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.7;
		pointer-events: none;
	}

	mark.hl:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 1px;
	}

	@media (prefers-color-scheme: dark) {
		mark.yellow {
			background: #5f5300;
		}

		mark.green {
			background: #20532b;
		}

		mark.blue {
			background: #1d4678;
		}

		mark.pink {
			background: #6e2747;
		}

		mark.hl:focus-visible {
			outline-color: #6cb4ff;
		}
	}

	:global(::highlight(reader-lookup)) {
		background-color: color-mix(in srgb, #0b6bcb 22%, transparent);
	}
</style>
