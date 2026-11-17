<script lang="ts">
	// A tooltip (design §5; WCAG 1.4.13): shown while its trigger is hovered
	// or has keyboard focus, stays while the pointer is over the tip itself,
	// and Escape hides it without moving focus (the key stops here, so a
	// surrounding menu or dialog closes only on the next Escape).
	//
	// API: <Tooltip text placement? describe? open?>{#snippet children(tipId)}…{/snippet}</Tooltip>
	//   text       the tip's words (the caller passes t(…))
	//   placement  'below' (default) | 'above' | 'start' | 'end' | 'below-end' | 'below-start'
	//              ('below-end' / 'below-start': under the trigger, aligned to its end / start edge —
	//              for triggers at the window's end, so the tip never overflows)
	//   describe   false (default): the tip repeats the trigger's own name
	//              (IconButton) and is hidden from assistive tech; true: the
	//              trigger must set aria-describedby={tipId}
	//   open       bindable; the gallery renders it open
	//   suppress   keeps it hidden (a menu button while its menu is open)
	import type { Snippet } from 'svelte';

	let {
		text,
		placement = 'below',
		describe = false,
		open = $bindable(false),
		suppress = false,
		children
	}: {
		text: string;
		placement?: 'below' | 'above' | 'start' | 'end' | 'below-end' | 'below-start';
		describe?: boolean;
		open?: boolean;
		suppress?: boolean;
		children: Snippet<[string]>;
	} = $props();

	const uid = $props.id();
	const tipId = `${uid}-tip`;
	let hovered = false;
	let focused = false;

	function sync(): void {
		open = hovered || focused;
	}

	function keyboardFocus(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		try {
			return target.matches(':focus-visible');
		} catch {
			return true; // an engine without :focus-visible: show on every focus
		}
	}
</script>

<span
	class="tooltip-anchor"
	role="presentation"
	onpointerenter={(e) => {
		if (e.pointerType === 'touch') return;
		hovered = true;
		sync();
	}}
	onpointerleave={() => {
		hovered = false;
		sync();
	}}
	onfocusin={(e) => {
		focused = keyboardFocus(e.target);
		sync();
	}}
	onfocusout={() => {
		focused = false;
		sync();
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			e.stopPropagation();
			hovered = false;
			focused = false;
			open = false;
		}
	}}
>
	{@render children(tipId)}
	<span
		id={tipId}
		role="tooltip"
		class="tip {placement}"
		data-open={open && !suppress ? 'true' : 'false'}
		aria-hidden={describe ? undefined : 'true'}>{text}</span
	>
</span>

<style>
	.tooltip-anchor {
		position: relative;
		display: inline-flex;
	}
	.tip {
		position: absolute;
		z-index: var(--layer-float);
		width: max-content;
		max-width: 16rem;
		padding: var(--space-1) var(--space-2);
		border-radius: calc(var(--radius) * 0.6);
		background: var(--text);
		color: var(--panel);
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		line-height: var(--line-tight);
		white-space: normal;
		pointer-events: none;
		opacity: 0;
		visibility: hidden;
		transition:
			opacity var(--motion-fast) var(--ease-standard),
			visibility 0s linear var(--motion-fast);
	}
	.tip[data-open='true'] {
		opacity: 1;
		visibility: visible;
		/* Hoverable (1.4.13): the pointer may move onto the tip. */
		pointer-events: auto;
		transition: opacity var(--motion-fast) var(--ease-standard);
	}
	/* Bridges the gap to the trigger, so moving onto the tip keeps it open. */
	.tip[data-open='true']::before {
		content: '';
		position: absolute;
		inset: calc(-1 * var(--space-1) - 1px);
	}
	.below {
		top: calc(100% + var(--space-1));
		left: 50%;
		translate: -50% 0;
	}
	.below-start {
		top: calc(100% + var(--space-1));
		inset-inline-start: 0;
	}
	.below-end {
		top: calc(100% + var(--space-1));
		inset-inline-end: 0;
	}
	.above {
		bottom: calc(100% + var(--space-1));
		left: 50%;
		translate: -50% 0;
	}
	.start {
		right: calc(100% + var(--space-1));
		top: 50%;
		translate: 0 -50%;
	}
	.end {
		left: calc(100% + var(--space-1));
		top: 50%;
		translate: 0 -50%;
	}
	@media (forced-colors: active) {
		.tip {
			border: 1px solid CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
</style>
