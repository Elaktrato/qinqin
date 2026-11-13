<script lang="ts">
	import { flushSync } from 'svelte';
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
		cells,
		active = $bindable(0),
		tipId,
		tipElementId,
		ontip,
		onhide
	}: {
		sectionId: string;
		label: string;
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

	// A big section paints its first batch at once and fills in over the
	// next frames. A filter that changes the cell count starts over; a
	// mastery update (same cells, new states) keeps what is rendered.
	const total = $derived(cells.length);
	let rendered = $derived.by(() => {
		void total;
		return 0;
	});
	const count = $derived(renderedCount(cells.length, rendered, current));
	const visible = $derived(count >= cells.length ? cells : cells.slice(0, count));

	$effect(() => {
		const shown = count;
		if (shown >= cells.length) return;
		// The next batch goes in after the current one has painted.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const frame = requestAnimationFrame(() => {
			timer = setTimeout(() => (rendered = shown), 0);
		});
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	});

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
		// Render up to the target before focusing it (Ctrl+End in a section
		// that is still filling in).
		flushSync(() => (active = next));
		const el = cellElement(next);
		el?.focus({ preventScroll: true });
		el?.scrollIntoView({ block: 'nearest' });
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
	aria-label="{label}: characters"
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
			tabindex={i === current ? 0 : -1}
			aria-label="{cell.char.c}, {STAGE_NAME[cell.stage]}">{cell.char.c}</a
		>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(2.6rem, 1fr));
		gap: 0.25rem;
		padding: 0.25rem 0 0.5rem;
	}

	.cell {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		min-height: 2.4rem;
		box-sizing: border-box;
		border-radius: 0.3rem;
		border: 1px solid var(--st-edge);
		font-size: 1.2rem;
		line-height: 1;
		text-decoration: none;
	}

	.cell:focus-visible {
		outline: 3px solid var(--st-focus);
		outline-offset: 1px;
		z-index: 1;
	}

	.cell:hover {
		border-color: currentColor;
	}

	/* Not studied: neutral and dashed, so it never reads as "fresh". */
	.st-unknown {
		background: var(--st-unknown-bg);
		color: var(--st-unknown-fg);
		border-style: dashed;
		border-color: var(--st-unknown-edge);
	}

	.st-fresh {
		background: var(--st-fresh-bg);
		color: var(--st-fresh-fg);
	}

	.st-learning {
		background: var(--st-learning-bg);
		color: var(--st-learning-fg);
	}

	.st-mature {
		background: var(--st-mature-bg);
		color: var(--st-mature-fg);
	}

	.st-learned {
		background: var(--st-learned-bg);
		color: var(--st-learned-fg);
		border-color: var(--st-learned-fg);
	}

	/* Learned: a corner tick, so the band does not rely on colour alone. */
	.st-learned::after {
		content: '';
		position: absolute;
		top: 0;
		right: 0;
		width: 0.7rem;
		height: 0.7rem;
		border-top-right-radius: 0.25rem;
		background: var(--st-learned-fg);
		clip-path: polygon(0 0, 100% 0, 100% 100%);
	}

	.st-learned::before {
		content: '';
		position: absolute;
		top: 0.08rem;
		right: 0.06rem;
		width: 0.18rem;
		height: 0.3rem;
		border: solid var(--st-learned-bg);
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
			box-shadow: 0 0 0 4px var(--st-focus);
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cell:global(.flash) {
			animation: none;
			box-shadow: 0 0 0 3px var(--st-focus);
		}
	}
</style>
