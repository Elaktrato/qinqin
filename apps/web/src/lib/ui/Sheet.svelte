<script lang="ts">
	import { isImeKey } from '$lib/ui/ime';
	// The bottom sheet (design §9): the reader's lookup and the journal's
	// corrections on the phone. A modal dialog (lib/ui/modal.ts: focus moves
	// in, Tab stays inside, Escape closes, focus returns) anchored to the
	// bottom edge, as wide as the screen up to 40rem, scrolling inside.
	// Dragging the handle down past a quarter of its height (or a quick flick)
	// closes it; a sideways swipe pages through the caller's items (onnext /
	// onprev), with the arrow keys as the keyboard path. Slides in with
	// --motion-medium (nothing moves under reduced motion).
	//
	// API: <Sheet bind:open label onclose? onnext? onprev? initialFocus?>content</Sheet>
	//   open          bindable; the sheet exists only while open
	//   label         the accessible name (t(…)), e.g. the looked-up word
	//   onclose       called when the person dismisses it (or the browser closes it natively)
	//   returnFocus   where focus goes on close (default: the opener)
	//   onnext/onprev paging (swipe toward the start = next, mirrored in right-to-left text)
	//   initialFocus  a selector inside to focus first (else the first focusable)
	import type { Snippet } from 'svelte';
	import { onDestroy } from 'svelte';
	import { t } from '$lib/i18n';
	import IconButton from './IconButton.svelte';
	import { modal, wrapTab } from './modal';

	let {
		open = $bindable(false),
		label,
		onclose,
		returnFocus,
		onnext,
		onprev,
		initialFocus,
		children
	}: {
		open?: boolean;
		label: string;
		onclose?: () => void;
		/** Where focus goes after the sheet is gone (the lookup's paragraph), else the opener. */
		returnFocus?: () => HTMLElement | null;
		onnext?: () => void;
		onprev?: () => void;
		initialFocus?: string;
		children?: Snippet;
	} = $props();

	let sheet = $state<HTMLDialogElement>();
	let dragY = $state(0);
	let dragging = $state(false);
	let start: { x: number; y: number; at: number; id: number } | null = null;
	// Unmounting: modal.destroy() calls dialog.close(), whose queued `close`
	// event still reaches this listener from the detached element. That is
	// not a dismissal: a replacement lookup may already own the state.
	let destroying = false;
	onDestroy(() => (destroying = true));

	const SWIPE = 60; // px sideways for a page
	const FLICK = 0.5; // px per ms downwards for a quick close

	function dismiss(): void {
		if (!open || destroying) return;
		open = false;
		dragY = 0;
		onclose?.();
	}

	function rtl(): boolean {
		return sheet ? getComputedStyle(sheet).direction === 'rtl' : false;
	}

	function page(forward: boolean): boolean {
		const go = forward ? onnext : onprev;
		if (!go) return false;
		go();
		return true;
	}

	function editable(el: EventTarget | null): boolean {
		return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
	}

	function down(e: PointerEvent, handle: boolean): void {
		if (e.isPrimary === false) return;
		start = { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId };
		if (handle) {
			dragging = true;
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		}
	}

	function move(e: PointerEvent): void {
		if (!dragging || !start || e.pointerId !== start.id) return;
		dragY = Math.max(0, e.clientY - start.y);
	}

	function up(e: PointerEvent): void {
		if (!start || e.pointerId !== start.id) return;
		const dx = e.clientX - start.x;
		const dy = e.clientY - start.y;
		const ms = Math.max(1, performance.now() - start.at);
		if (dragging) {
			const height = sheet?.offsetHeight ?? 0;
			const far = dy > Math.max(80, height * 0.25);
			const flick = dy > 40 && dy / ms > FLICK;
			dragging = false;
			start = null;
			if (far || flick) dismiss();
			else dragY = 0;
			return;
		}
		start = null;
		if (Math.abs(dx) >= SWIPE && Math.abs(dx) > 2 * Math.abs(dy)) {
			const towardStart = rtl() ? dx > 0 : dx < 0;
			page(towardStart);
		}
	}

	function onkeydown(e: KeyboardEvent): void {
		// An inner action (an inline rename, a delete confirmation, a menu)
		// took the key first: Escape cancels that, not the whole sheet (the
		// old drawer's keys checked the same).
		if (e.defaultPrevented || isImeKey(e)) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			dismiss();
			return;
		}
		if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !editable(e.target)) {
			const forward = (e.key === 'ArrowRight') !== rtl();
			if (page(forward)) e.preventDefault();
			return;
		}
		if (sheet) wrapTab(e, sheet);
	}
</script>

{#if open}
	<dialog
		bind:this={sheet}
		use:modal={{ initialFocus, returnFocus }}
		class="sheet"
		class:dragging
		style:translate={dragY ? `0 ${dragY}px` : undefined}
		aria-modal="true"
		aria-label={label}
		onclose={dismiss}
		oncancel={(e) => {
			e.preventDefault();
			dismiss();
		}}
		{onkeydown}
	>
		<div class="top">
			<span
				class="grab"
				aria-hidden="true"
				onpointerdown={(e) => down(e, true)}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={() => {
					dragging = false;
					start = null;
					dragY = 0;
				}}><i></i></span
			>
			<IconButton label={t('common.action.close')} icon="close" placement="start" onclick={dismiss} />
		</div>
		<div class="body" role="presentation" onpointerdown={(e) => down(e, false)} onpointerup={up}>
			{@render children?.()}
		</div>
	</dialog>
{/if}

<style>
	.sheet {
		position: fixed;
		inset-block-end: 0;
		inset-block-start: auto;
		inset-inline: 0;
		box-sizing: border-box;
		width: 100%;
		max-width: 40rem;
		max-height: 85dvh;
		margin: 0 auto;
		padding: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hair);
		border-bottom: 0;
		border-radius: var(--radius-large) var(--radius-large) 0 0;
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-float);
		overflow: hidden;
		animation: sheet-in var(--motion-medium) var(--ease-standard);
		transition: translate var(--motion-fast) var(--ease-standard);
	}
	.sheet.dragging {
		transition: none;
	}
	.sheet::backdrop {
		background: color-mix(in srgb, var(--chrome) 50%, transparent);
	}
	.top {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		padding: var(--space-1) var(--space-2) 0;
	}
	.top > :global(:last-child) {
		justify-self: end;
	}
	/* The drag handle: a short bar in the middle, with a large grab area. */
	.grab {
		grid-column: 2;
		display: grid;
		place-items: center;
		width: 4rem;
		height: var(--hit);
		cursor: grab;
		touch-action: none;
	}
	.grab i {
		width: 2.25rem;
		height: 4px;
		border-radius: 2px;
		background: var(--line);
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		/* viewport-fit=cover: the last rows stay above the home indicator. */
		padding: 0 var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
		touch-action: pan-y;
	}
	@keyframes sheet-in {
		from {
			translate: 0 100%;
		}
	}
	@media (forced-colors: active) {
		.sheet {
			border-color: CanvasText;
		}
		.grab i {
			background: CanvasText;
		}
	}
</style>
