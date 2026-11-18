<script module lang="ts">
	import { nextBatchOwner } from '$lib/study/mapGrid';

	interface BatchJob {
		order: number;
		urgent: boolean;
		run: () => void;
	}

	// One render batch per frame across all open sections, top-down (a
	// section waiting for a focus target first), so expanding everything
	// never builds 10k cells in one frame.
	const waiting: BatchJob[] = [];
	let pumping = false;

	function pump(): void {
		if (pumping || waiting.length === 0) return;
		pumping = true;
		// The batch goes in after the previous one has painted.
		requestAnimationFrame(() =>
			setTimeout(() => {
				pumping = false;
				const index = nextBatchOwner(waiting);
				if (index >= 0) waiting.splice(index, 1)[0].run();
				pump();
			}, 0)
		);
	}

	function enqueue(job: BatchJob): () => void {
		waiting.push(job);
		pump();
		return () => {
			const index = waiting.indexOf(job);
			if (index >= 0) waiting.splice(index, 1);
		};
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import type { CellState } from '$lib/study/charGroups';
	import {
		STAGE_INFO,
		columnCount,
		gridMove,
		renderedCount,
		type TipRequest
	} from '$lib/study/mapGrid';

	let {
		sectionId,
		label,
		order,
		cells,
		active = $bindable(0),
		tipId,
		tipElementId,
		ontip,
		onhide
	}: {
		sectionId: string;
		label: string;
		/** Position on the page: earlier sections render their batches first. */
		order: number;
		cells: CellState[];
		active?: number;
		/** Entry id of the cell whose popover is showing, if any. */
		tipId: number | null;
		tipElementId: string;
		ontip: (request: TipRequest) => void;
		/** Hide the popover; `force` also hides one shown for focus. */
		onhide: (force: boolean) => void;
	} = $props();

	const STAGE_NAME = Object.fromEntries(
		STAGE_INFO.map(({ stage, label: name }) => [stage, name.toLowerCase()])
	);

	let grid = $state<HTMLElement | null>(null);
	let lastPointer = '';

	// The roving tab stop must point at an existing cell after a filter.
	const current = $derived(Math.min(Math.max(0, active), Math.max(0, cells.length - 1)));

	// A big section paints its first batch at once and fills in one batch
	// per frame. A filter that changes the cell count starts over; a
	// mastery update (same cells, new states) keeps what is rendered.
	const total = $derived(cells.length);
	let rendered = $derived.by(() => {
		void total;
		return 0;
	});
	const count = $derived(renderedCount(cells.length, rendered));
	const visible = $derived(count >= cells.length ? cells : cells.slice(0, count));
	// The tab stop is the active cell once it is rendered, else the first.
	const stop = $derived(current < count ? current : 0);

	// A keyboard or jump target that is not rendered yet: the batches go on
	// (this section first) and the cell is focused as soon as it exists.
	let target = $state<number | null>(null);
	let onTarget: ((el: HTMLElement | null) => void) | null = null;

	$effect(() => {
		const shown = count;
		if (shown >= cells.length) return;
		return enqueue({ order, urgent: target !== null, run: () => (rendered = shown) });
	});

	$effect(() => {
		const wanted = target;
		if (wanted === null || wanted >= count) return;
		void tick().then(() => {
			const resolve = onTarget;
			target = null;
			onTarget = null;
			resolve?.(cellElement(wanted));
		});
	});

	/**
	 * reveal makes cell `index` the tab stop and resolves with its element
	 * once it is rendered (batches keep running; nothing renders at once).
	 */
	export function reveal(index: number): Promise<HTMLElement | null> {
		active = index;
		onTarget?.(null);
		if (index < count) {
			target = null;
			onTarget = null;
			return tick().then(() => cellElement(index));
		}
		return new Promise((resolve) => {
			onTarget = resolve;
			target = index;
		});
	}

	function cellAt(target: EventTarget | null): { el: HTMLElement; index: number } | null {
		if (!(target instanceof Element)) return null;
		const el = target.closest<HTMLElement>('[data-i]');
		if (el === null || !grid?.contains(el)) return null;
		const index = Number(el.dataset.i);
		return Number.isInteger(index) && index < cells.length ? { el, index } : null;
	}

	function cellElement(index: number): HTMLElement | null {
		return grid?.querySelector<HTMLElement>(`[data-i="${index}"]`) ?? null;
	}

	function onkeydown(event: KeyboardEvent) {
		lastPointer = '';
		const hit = cellAt(event.target);
		if (hit === null) return;
		if (event.key === 'Escape') {
			onhide(true);
			return;
		}
		if (event.altKey || event.metaKey || event.shiftKey) return;
		const columns = grid ? columnCount(getComputedStyle(grid).gridTemplateColumns) : 1;
		const next = gridMove(hit.index, event.key, cells.length, columns, event.ctrlKey);
		if (next === null) return;
		event.preventDefault();
		void reveal(next).then((el) => {
			el?.focus({ preventScroll: true });
			el?.scrollIntoView({ block: 'nearest' });
		});
	}

	function onfocusin(event: FocusEvent) {
		const hit = cellAt(event.target);
		if (hit === null) return;
		active = hit.index;
		hit.el.setAttribute('aria-describedby', tipElementId);
		// A pointer focus is handled by hover (mouse) or the first tap
		// (touch, in onclick); only keyboard focus shows the popover here.
		if (lastPointer !== '') return;
		ontip({ cell: cells[hit.index], el: hit.el, via: 'focus' });
	}

	function onfocusout(event: FocusEvent) {
		const hit = cellAt(event.target);
		hit?.el.removeAttribute('aria-describedby');
		if (cellAt(event.relatedTarget) === null) onhide(true);
	}

	function onpointerdown(event: PointerEvent) {
		lastPointer = event.pointerType;
	}

	function onpointerover(event: PointerEvent) {
		if (event.pointerType !== 'mouse') return;
		const hit = cellAt(event.target);
		if (hit !== null) ontip({ cell: cells[hit.index], el: hit.el, via: 'hover' });
	}

	function onpointerleave(event: PointerEvent) {
		if (event.pointerType === 'mouse') onhide(false);
	}

	function onclick(event: MouseEvent) {
		const hit = cellAt(event.target);
		if (hit === null) return;
		// Touch has no hover: the first tap shows the popover, the second
		// one on the same cell opens the entry.
		if (lastPointer === 'touch' && tipId !== cells[hit.index].char.i) {
			event.preventDefault();
			active = hit.index;
			hit.el.focus({ preventScroll: true });
			ontip({ cell: cells[hit.index], el: hit.el, via: 'tap' });
		}
		lastPointer = '';
	}
</script>

<!-- The handlers are delegated from the focusable cells (links) inside. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="grid"
	role="group"
	aria-label={t('stats.map.gridLabel', { group: label })}
	data-section={sectionId}
	bind:this={grid}
	{onkeydown}
	{onfocusin}
	{onfocusout}
	{onpointerdown}
	{onpointerover}
	{onpointerleave}
	{onclick}
>
	{#each visible as cell, i (cell.char.i)}
		<a
			href="/entry/{cell.char.i}"
			class="cell st-{cell.stage}"
			data-i={i}
			tabindex={i === stop ? 0 : -1}
			aria-label="{cell.char.c}, {STAGE_NAME[cell.stage]}"
			><span class="glyph">{cell.char.c}</span></a
		>
	{/each}
</div>

<style>
	/* The single-hue mastery ramp (design §9): stage 0 is an outline, then
	   the accent at 14 / 32 / 58 / 100 %. Shape cues (the bottom bar's
	   length and the learned tick) repeat the stage without colour. The
	   glyph sits on a --panel tile: the ramp's mid-tones cannot carry text
	   at 4.5:1, while --text on --panel is the theme contract's pair. */
	.grid {
		--cell-size: 34px;
		display: grid;
		grid-template-columns: repeat(auto-fill, var(--cell-size));
		gap: 4px;
		padding: var(--space-1) 0 var(--space-2);
	}

	.cell {
		--glyph-inset: 3px;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--cell-size);
		height: var(--cell-size);
		box-sizing: border-box;
		border: 1px solid transparent;
		border-radius: calc(var(--radius) * 0.5);
		font-size: 18px;
		line-height: 1;
		text-decoration: none;
	}

	/* The contrast-backed glyph: a panel tile inside the tinted cell. */
	.glyph {
		position: absolute;
		inset: var(--glyph-inset);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: calc(var(--radius) * 0.35);
		background: var(--panel);
	}

	.cell:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
		z-index: 1;
	}

	/* Not studied: an outline, no fill. --muted is the ≥ 3:1 edge every
	   built-in theme carries (--line is 1.33-2.79 on the panel). */
	.st-unknown {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--muted);
		color: var(--text);
	}

	.st-unknown .glyph {
		background: transparent;
	}

	.st-fresh {
		background: var(--mastery-1);
		color: var(--text);
	}

	.st-learning {
		background: var(--mastery-2);
		color: var(--text);
	}

	.st-mature {
		background: var(--mastery-3);
		color: var(--text);
	}

	.st-learned {
		background: var(--mastery-4);
		color: var(--text);
	}

	/* Started but not learned: a bar on the glyph's panel tile whose length
	   grows with the band (a quarter, a half, three quarters), so fresh,
	   learning and mature differ from each other and from "not studied"
	   without colour. */
	.st-fresh::after,
	.st-learning::after,
	.st-mature::after {
		content: '';
		position: absolute;
		left: calc(var(--glyph-inset) + 0.2rem);
		bottom: calc(var(--glyph-inset) + 0.18rem);
		width: calc((100% - 2 * var(--glyph-inset) - 0.4rem) * 0.25);
		height: 0.16rem;
		border-radius: 0.1rem;
		background: currentColor;
	}

	.st-learning::after {
		width: calc((100% - 2 * var(--glyph-inset) - 0.4rem) * 0.5);
	}

	.st-mature::after {
		width: calc((100% - 2 * var(--glyph-inset) - 0.4rem) * 0.75);
	}

	/* Learned: a corner tick on the panel tile, so the band does not rely on
	   colour alone. --text on --panel is the same ≥ 4.5:1 pair as the glyph;
	   the check is a --panel notch in the tick. */
	.st-learned::after {
		content: '';
		position: absolute;
		top: var(--glyph-inset);
		right: var(--glyph-inset);
		width: 0.7rem;
		height: 0.7rem;
		border-top-right-radius: 0.25rem;
		background: var(--text);
		clip-path: polygon(0 0, 100% 0, 100% 100%);
	}

	.st-learned::before {
		content: '';
		position: absolute;
		top: calc(var(--glyph-inset) + 0.08rem);
		right: calc(var(--glyph-inset) + 0.06rem);
		width: 0.18rem;
		height: 0.3rem;
		border: solid var(--panel);
		border-width: 0 0.1rem 0.1rem 0;
		transform: rotate(45deg);
		z-index: 1;
	}

	.cell:global(.flash) {
		animation: flash 1.2s ease-out 1;
	}

	@keyframes flash {
		0%,
		40% {
			box-shadow: 0 0 0 4px var(--focus-colour);
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
	}

	@media (max-width: 719px) {
		.grid {
			--cell-size: 30px;
		}
		.cell {
			font-size: 16px;
		}
	}

	/* A coarse pointer keeps the 30/34 px visual but gives each cell the
	   app's --hit (2.75rem) target through the glyph's invisible overlay. */
	@media (pointer: coarse) {
		.glyph::before {
			content: '';
			position: absolute;
			inset: calc((var(--cell-size) - 2 * var(--glyph-inset) - var(--hit)) / 2);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cell:global(.flash) {
			animation: none;
			box-shadow: 0 0 0 3px var(--focus-colour);
		}
	}

	/* Forced colours: fills carry no meaning; the border style does (a
	   shape cue per stage), and the glyph stays CanvasText. */
	@media (forced-colors: active) {
		.cell {
			background: Canvas;
			color: CanvasText;
			border-color: CanvasText;
			box-shadow: none;
		}
		.glyph {
			background: transparent;
		}
		.st-unknown {
			border-style: dotted;
			border-width: 1px;
		}
		.st-fresh {
			border-style: dashed;
			border-width: 1px;
		}
		.st-learning {
			border-style: solid;
			border-width: 1px;
		}
		.st-mature {
			border-style: solid;
			border-width: 2px;
		}
		.st-learned {
			border-style: double;
			border-width: 3px;
		}
		.st-fresh::after,
		.st-learning::after,
		.st-mature::after,
		.st-learned::after {
			background: CanvasText;
		}
		.st-learned::before {
			border-color: Canvas;
		}
	}
</style>
