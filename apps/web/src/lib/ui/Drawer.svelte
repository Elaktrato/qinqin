<script lang="ts">
	// The side drawer (design §9, the phone menu): a modal dialog like Sheet
	// (lib/ui/modal.ts: focus moves in, Tab stays inside, Escape closes,
	// focus returns, the page behind is inert) anchored to the inline-start
	// edge, full height, min(20rem, 85vw) wide, on --chrome. A click on the
	// scrim closes it; so does a swipe toward the start beyond a third of its
	// width (mirrored in right-to-left text). Slides in with --motion-medium
	// (the motion tokens are 0 under reduced motion, app.css).
	//
	// API: <Drawer bind:open label id? initialFocus? onclose?>content</Drawer>
	//   open          bindable; the drawer exists only while open
	//   label         the accessible name (t(…))
	//   id            the dialog's id (the opener's aria-controls)
	//   initialFocus  a selector inside to focus first (else the first focusable)
	//   onclose       called when the person dismisses it (Escape, scrim, swipe)
	import type { Snippet } from 'svelte';
	import { modal, wrapTab } from './modal';

	let {
		open = $bindable(false),
		label,
		id,
		initialFocus,
		onclose,
		children
	}: {
		open?: boolean;
		label: string;
		id?: string;
		initialFocus?: string;
		onclose?: () => void;
		children?: Snippet;
	} = $props();

	let panel = $state<HTMLElement>();
	let dragX = $state(0);
	let start: { x: number; y: number; id: number } | null = null;
	let dragging = $state(false);

	function dismiss(): void {
		if (!open) return;
		open = false;
		dragX = 0;
		onclose?.();
	}

	function rtl(): boolean {
		return panel ? getComputedStyle(panel).direction === 'rtl' : false;
	}

	/** How far the pointer moved toward the inline start (negative: toward the end). */
	function towardStart(e: PointerEvent): number {
		if (!start) return 0;
		const dx = e.clientX - start.x;
		return rtl() ? dx : -dx;
	}

	function down(e: PointerEvent): void {
		if (e.isPrimary === false) return;
		start = { x: e.clientX, y: e.clientY, id: e.pointerId };
	}

	function move(e: PointerEvent): void {
		if (!start || e.pointerId !== start.id) return;
		const along = towardStart(e);
		if (!dragging && along > 10 && along > Math.abs(e.clientY - start.y)) dragging = true;
		if (dragging) dragX = Math.max(0, along);
	}

	function up(e: PointerEvent): void {
		if (!start || e.pointerId !== start.id) return;
		const along = towardStart(e);
		const width = panel?.offsetWidth ?? 0;
		start = null;
		dragging = false;
		if (along > Math.max(48, width / 3)) dismiss();
		else dragX = 0;
	}

	function cancel(): void {
		start = null;
		dragging = false;
		dragX = 0;
	}

	function onkeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			dismiss();
			return;
		}
		if (panel) wrapTab(e, panel);
	}

	// The dialog box is exactly the panel, so a click whose target is the
	// dialog itself landed on the ::backdrop (the scrim).
	function onclick(e: MouseEvent): void {
		if (e.target === e.currentTarget) dismiss();
	}
</script>

{#if open}
	<dialog
		use:modal={initialFocus}
		{id}
		class="drawer"
		class:dragging
		style:--drag={dragX ? `${dragX}px` : undefined}
		aria-modal="true"
		aria-label={label}
		oncancel={(e) => {
			e.preventDefault();
			dismiss();
		}}
		{onkeydown}
		{onclick}
	>
		<div
			class="drawer-panel"
			role="presentation"
			bind:this={panel}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={cancel}
		>
			{@render children?.()}
		</div>
	</dialog>
{/if}

<style>
	.drawer {
		--slide: -1;
		position: fixed;
		inset-block: 0;
		inset-inline-start: 0;
		inset-inline-end: auto;
		box-sizing: border-box;
		width: min(20rem, 85vw);
		max-width: none;
		height: 100dvh;
		max-height: none;
		margin: 0;
		padding: 0;
		border: 0;
		border-inline-end: 1px solid var(--hair);
		background: var(--chrome);
		color: var(--text);
		box-shadow: var(--shadow-float);
		overflow: hidden;
		translate: calc(var(--slide) * var(--drag, 0px)) 0;
		animation: drawer-in var(--motion-medium) var(--ease-standard);
		transition: translate var(--motion-fast) var(--ease-standard);
	}
	:global([dir='rtl']) .drawer {
		--slide: 1;
	}
	.drawer.dragging {
		transition: none;
	}
	.drawer::backdrop {
		background: color-mix(in srgb, var(--chrome) 60%, transparent);
	}
	.drawer-panel {
		box-sizing: border-box;
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		padding-block: env(safe-area-inset-top, 0px) env(safe-area-inset-bottom, 0px);
		touch-action: pan-y;
	}
	@keyframes drawer-in {
		from {
			translate: calc(var(--slide) * 100%) 0;
		}
	}
	@media (forced-colors: active) {
		.drawer {
			border-inline-end-color: CanvasText;
		}
	}
</style>
