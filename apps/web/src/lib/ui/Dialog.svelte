<script lang="ts">
	// A modal dialog: the native <dialog> (lib/ui/modal.ts) with a title, an
	// optional description, content and an actions row. A floating layer
	// (panel, --radius-large, --shadow-float) over a backdrop dimmed from
	// --chrome. Escape (or the browser's cancel) closes it once; focus
	// returns to where it was.
	//
	// API: <Dialog bind:open title description? describedBy? onclose? initialFocus? dismissible?>content{#snippet actions()}…{/snippet}</Dialog>
	//   open          bindable; the dialog exists only while open
	//   title         the heading and accessible name (t(…))
	//   description   a short line under the title; the accessible description
	//   describedBy   the id of content inside the dialog that describes it (a list, say), instead
	//   onclose       called when the person dismisses it (Escape, cancel)
	//   initialFocus  a selector inside the dialog to focus first (else the first focusable)
	//   dismissible   false while an action runs: Escape and cancel do nothing (default true)
	//   actions       the buttons row (Button components), end-aligned
	import type { Snippet } from 'svelte';
	import { modal, wrapTab } from './modal';

	let {
		open = $bindable(false),
		title,
		description,
		describedBy,
		onclose,
		initialFocus,
		dismissible = true,
		children,
		actions
	}: {
		open?: boolean;
		title: string;
		description?: string;
		describedBy?: string;
		onclose?: () => void;
		initialFocus?: string;
		dismissible?: boolean;
		children?: Snippet;
		actions?: Snippet;
	} = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();

	function dismiss(): void {
		if (!open || !dismissible) return;
		open = false;
		onclose?.();
	}
</script>

{#if open}
	<dialog
		bind:this={dialog}
		use:modal={initialFocus}
		class="dialog"
		aria-modal="true"
		aria-labelledby="{uid}-title"
		aria-describedby={describedBy ?? (description ? `${uid}-text` : undefined)}
		oncancel={(e) => {
			e.preventDefault();
			dismiss();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				dismiss();
			} else if (dialog) wrapTab(e, dialog);
		}}
	>
		<h2 class="title" id="{uid}-title">{title}</h2>
		{#if description}<p class="description" id="{uid}-text">{description}</p>{/if}
		{@render children?.()}
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</dialog>
{/if}

<style>
	.dialog {
		box-sizing: border-box;
		width: min(30rem, calc(100vw - 2 * var(--space-4)));
		max-height: calc(100dvh - 2 * var(--space-4));
		overflow: auto;
		padding: var(--space-5);
		border: 1px solid var(--hair);
		border-radius: var(--radius-large);
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-float);
		animation: dialog-in var(--motion-fast) var(--ease-standard);
	}
	.dialog::backdrop {
		background: color-mix(in srgb, var(--chrome) 60%, transparent);
	}
	.dialog:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.title {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-l);
		font-weight: var(--weight-strong);
		line-height: var(--line-tight);
	}
	.description {
		margin: 0 0 var(--space-4);
		color: var(--readable-muted);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}
	@keyframes dialog-in {
		from {
			opacity: 0;
			scale: 0.98;
		}
	}
	@media (forced-colors: active) {
		.dialog {
			border-color: CanvasText;
		}
	}
</style>
