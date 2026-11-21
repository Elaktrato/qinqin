<script lang="ts">
	// The one box (design §5). Use it only where an element is a separate
	// object: the content surface of the frame, an inset that must read as
	// one thing (a preview, a code block), a selected row's group. Everything
	// else groups with space and Section.
	//
	// API: <Panel raised? …rest>content</Panel>
	//   raised  the inset surface (--raised) instead of --panel
	//   …rest   passed to the <div>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		raised = false,
		class: className = '',
		children,
		...rest
	}: { raised?: boolean; children: Snippet; class?: string } & Omit<HTMLAttributes<HTMLDivElement>, 'children'> = $props();
</script>

<div class="panel {className}" class:raised {...rest}>{@render children()}</div>

<style>
	.panel {
		padding: var(--space-4);
		border-radius: var(--radius-large);
		background: var(--panel);
		color: var(--text);
	}
	.raised {
		background: var(--raised);
	}
	@media (forced-colors: active) {
		.panel {
			border: 1px solid CanvasText;
		}
	}
</style>
