<script lang="ts">
	// The card's prompt (#101): centred. Cards mark their parts with the
	// shared classes so every kind looks alike: .fp-word (CJK 4rem, regular),
	// .fp-sentence (CJK 1.5rem), .fp-meaning (1.375rem, 500), .fp-sub (muted).
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="face-prompt">{@render children()}</div>

<style>
	.face-prompt {
		display: grid;
		gap: var(--space-1);
		justify-items: center;
		text-align: center;
		padding: var(--space-2) 0;
		overflow-wrap: anywhere;
	}
	.face-prompt :global(:where(p, ul, ol)) {
		margin: 0;
	}
	.face-prompt :global(.fp-word) {
		font-family: var(--font-hanzi);
		font-size: 4rem;
		font-weight: var(--weight-regular);
		line-height: var(--line-tight);
	}
	.face-prompt :global(.fp-sentence) {
		font-family: var(--font-hanzi);
		font-size: var(--font-size-xl);
		line-height: 1.6;
	}
	.face-prompt :global(.fp-meaning) {
		font-size: 1.375rem;
		font-weight: var(--weight-medium);
		line-height: var(--line-tight);
	}
	.face-prompt :global(.fp-sub) {
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
	@media (max-width: 30rem) {
		.face-prompt :global(.fp-word) {
			font-size: 3.25rem;
		}
		.face-prompt :global(.fp-sentence) {
			font-size: var(--font-size-l);
		}
	}
</style>
