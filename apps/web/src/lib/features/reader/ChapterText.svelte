<script lang="ts">
	import { onDestroy } from 'svelte';
	import { planParagraph, type PlanSeg } from './chapterPlan';
	import { DEFAULT_DISPLAY, type ReaderDisplay } from './displaySettings';
	import { fontStack } from './fonts';
	import { packFaces } from '$lib/fonts/packFaces.svelte';
	import type { Highlight } from './highlights';
	import type { Run } from './paragraphText';
	import { createReveal, type Reveal } from './reveal';
	import type { Piece } from './smartReadings';
	import type { LookupController } from './useLookup.svelte';
	import type { WordRange } from './wordRanges';

	// Renders the chapter as real, selectable text. The markup is the
	// contract dom.ts maps against: <p data-p> per paragraph, one element
	// with data-r per run whose first text node is the displayed run text,
	// the book's furigana (when shown) in an <rt> after it. A paragraph with
	// highlights or generated readings cuts its runs into pieces instead
	// (<span>/<mark>/<ruby> with data-o, the piece's UTF-16 start in its
	// run), all inside the run's element and before its <rt>; a generated
	// <ruby> piece holds its own <rt> after the base text. Runs are written
	// without whitespace between them so no stray spaces enter CJK text.
	// Word states (#68) only add a class (w-new / w-learning, w-end on a
	// word's last piece) to existing <span data-o> / <ruby> pieces, so the
	// offsets stay the same; their styles are global (app.css).
	let {
		paragraphs,
		display = DEFAULT_DISPLAY,
		pieces = new Map<number, Piece[]>(),
		words = new Map<number, WordRange[]>(),
		lang,
		lookup,
		reveal = createReveal(),
		showAll = false,
		marked = new Set<number>(),
		highlights = new Map<number, Highlight[]>(),
		onhighlight,
		container = $bindable(null)
	}: {
		paragraphs: Run[][];
		/** Reading display settings: book ruby, ruby size, font. */
		display?: ReaderDisplay;
		/** Readings per paragraph (smartReadings.annotateParagraph). */
		pieces?: ReadonlyMap<number, Piece[]>;
		/** New and learning words per paragraph (wordRanges); empty when highlighting is off. */
		words?: ReadonlyMap<number, WordRange[]>;
		lang: string;
		lookup: LookupController;
		/** Hides revealed readings; BookView owns it for the `R` key. */
		reveal?: Reveal;
		/** Show all readings (also the concealed ones). */
		showAll?: boolean;
		/** Paragraphs with a bookmark: they get a margin marker. */
		marked?: ReadonlySet<number>;
		/** The highlights to draw, per paragraph (visibleHighlights' `drawn`). */
		highlights?: ReadonlyMap<number, Highlight[]>;
		/** A highlight was clicked (or Enter pressed on a focused one). */
		onhighlight?: (id: number, mark: HTMLElement) => void;
		container?: HTMLElement | null;
	} = $props();

	function planOf(runs: Run[], drawn: Highlight[], list: readonly Piece[], ranges: readonly WordRange[]) {
		return planParagraph(runs, drawn, list, display.bookRuby, ranges);
	}

	/** Paragraph code-point start of run r. */
	function bookStart(runs: Run[], r: number): number {
		let at = 0;
		for (let i = 0; i < r; i++) at += Array.from(runs[i].text).length;
		return at;
	}

	const stack = $derived(fontStack(display.font, lang, packFaces.installed));
	// A concrete reader font needs its pack face registered (#97); default is the app's.
	$effect(() => {
		packFaces.need('reader', display.font === 'default' ? [] : [display.font]);
		return () => packFaces.need('reader', []);
	});

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

	// A tap on a concealed word reveals it for a moment; the listeners only
	// observe, so the lookup keeps getting every event.
	$effect(() => {
		const el = container;
		if (!el) return;
		return reveal.attach(el);
	});

	onDestroy(() => reveal.reset());

	// A new chapter or script starts with every reading as the rule says.
	$effect(() => {
		void paragraphs;
		reveal.reset();
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

{#snippet piece(s: PlanSeg)}{#if s.highlight}<mark data-o={s.startInRun} data-h={s.highlight.id} class="hl {s.highlight.color}" class:noted={s.noteMark}>{s.text}</mark>{:else if s.rt !== undefined}<ruby data-o={s.startInRun} class="gen" class:w-new={s.word === 'new'} class:w-learning={s.word === 'learning'} class:w-end={s.wordEnd}>{s.text}<rt class:concealed={s.concealed}>{s.rt}</rt></ruby>{:else}<span data-o={s.startInRun} class:w-new={s.word === 'new'} class:w-learning={s.word === 'learning'} class:w-end={s.wordEnd}>{s.text}</span>{/if}{/snippet}

<div
	class="chapter-text"
	class:show-all={showAll}
	{lang}
	bind:this={container}
	style:--reader-rt-size="{display.rubyScale}em"
	style:--reader-font={stack === 'inherit' ? undefined : stack}
>
	{#each paragraphs as runs, p (p)}
		{@const drawn = highlights.get(p) ?? []}
		{@const list = pieces.get(p) ?? []}
		{@const ranges = words.get(p) ?? []}
		<!-- One <p> per paragraph whatever its content: the position observers watch these elements. -->
		<p data-p={p} class:bookmarked={marked.has(p)}>{#if drawn.length > 0 || ranges.length > 0 || list.some((x) => x.source === 'dict')}{#each planOf(runs, drawn, list, ranges) as g (g.run)}{#if g.ruby}<ruby data-r={g.run}>{#each g.segs as s (s.startInRun)}{@render piece(s)}{/each}<rt class:concealed={g.bookConcealed}>{g.ruby}</rt></ruby>{:else}<span data-r={g.run}>{#each g.segs as s (s.startInRun)}{@render piece(s)}{/each}</span>{/if}{/each}{:else}{#each runs as run, r (r)}{#if run.ruby && display.bookRuby}<ruby data-r={r}>{run.text}<rt class:concealed={list.find((x) => x.source === 'book' && x.start === bookStart(runs, r))?.concealed}>{run.ruby}</rt></ruby>{:else}<span data-r={r}>{run.text}</span>{/if}{/each}{/if}</p>
	{/each}
</div>

<style>
	.chapter-text {
		font-size: 1.25rem;
		line-height: 2;
		font-family: var(--reader-font, inherit);
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
		background: var(--accent);
		pointer-events: none;
	}

	/* Furigana is a reading aid, not part of the text: copying or
	   selecting a passage leaves it out. */
	rt {
		font-size: var(--reader-rt-size, 0.55em);
		user-select: none;
	}

	/* A reading of a known word: still laid out (revealing never moves the
	   text) and still in the accessibility tree, only drawn transparent.
	   Hover or a reveal (tap, Show all readings) draws it. */
	rt.concealed {
		color: transparent;
	}

	ruby:hover > rt.concealed,
	:global(ruby.revealed > rt.concealed),
	:global(.chapter-text.show-all rt.concealed) {
		color: inherit;
	}

	@media (forced-colors: active) {
		rt.concealed {
			color: inherit;
		}
	}

	/* Highlights: a soft wash of the theme under the text colour (yellow is
	   the design's --highlight-wash; green, blue and pink are 24% of their
	   own --highlight-* colour, named by hue in every theme — never a role
	   colour such as the accent, so the name says what is shown).
	   Decoration only for assistive technology: the Highlights panel is the
	   accessible path. */
	mark.hl {
		color: inherit;
		border-radius: 0.15em;
		cursor: pointer;
	}

	mark.yellow {
		background: var(--highlight-wash);
	}

	mark.green {
		background: color-mix(in srgb, var(--highlight-green) 24%, transparent);
	}

	mark.blue {
		background: color-mix(in srgb, var(--highlight-blue) 24%, transparent);
	}

	mark.pink {
		background: color-mix(in srgb, var(--highlight-pink) 24%, transparent);
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
		color: var(--readable-muted);
		pointer-events: none;
	}

	mark.hl:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	:global(::highlight(reader-lookup)) {
		background-color: var(--selected-wash);
	}
</style>
