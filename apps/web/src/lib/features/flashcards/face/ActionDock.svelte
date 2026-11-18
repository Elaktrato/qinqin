<script lang="ts">
	// The actions docked at the bottom (#101, design §9): before the answer
	// the card's one primary (soft accent), after it the grade bar; the key
	// map under them. Sticky at the viewport's bottom; a --hair line shows
	// only while content scrolls under it.
	import type { Snippet } from 'svelte';
	import Button from '$lib/ui/Button.svelte';
	import { useCardFace } from './cardFace.svelte';

	let { done, grades, keys }: { done: boolean; grades?: Snippet; keys: string } = $props();

	const face = useCardFace();
	let sentinel = $state<HTMLElement>();
	let under = $state(false);

	// The sentinel sits just above the dock: out of view = content is under the dock.
	$effect(() => {
		if (sentinel === undefined || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(([entry]) => (under = !entry.isIntersecting), {
			rootMargin: '0px 0px -1px 0px'
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<div class="sentinel" bind:this={sentinel} aria-hidden="true"></div>
<div class="dock" class:under>
	{#if done}
		{@render grades?.()}
	{:else if face.primary !== null}
		{@const primary = face.primary}
		<div class="main">
			<Button variant="primary" disabled={primary.disabled ?? false} onclick={() => primary.run()}>{primary.label}</Button>
		</div>
	{/if}
	<p class="keys">{keys}</p>
</div>

<style>
	.sentinel {
		height: 1px;
	}
	.dock {
		position: sticky;
		bottom: 0;
		display: grid;
		gap: var(--space-2);
		width: 100%;
		padding-top: var(--space-3);
		padding-bottom: max(var(--space-3), env(safe-area-inset-bottom));
		background: var(--panel);
		border-top: 1px solid transparent;
	}
	.dock.under {
		border-top-color: var(--hair);
	}
	.main :global(.button) {
		width: 100%;
		min-height: var(--hit);
	}
	.keys {
		margin: 0;
		text-align: center;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	@media (max-width: 30rem) {
		.keys {
			display: none;
		}
	}
</style>
