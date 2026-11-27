<script lang="ts">
	// A tag (#286): a small label with only an outline, no fill, rounded ends: the card header's level, deck and
	// status, later the entry page's level and frequency and the reader's lookup. The owner's decision amends the
	// "no pills" rule of the visual rework for tags only, never for navigation or buttons (design §2, §5). Outline
	// and text share one readable colour, at least 4.5:1 on the card in every theme (Tag.contrast.test.ts).
	//
	// API: <Tag tone?>text</Tag>
	//   tone  'neutral' (default, the muted text colour) | 'accent' (the readable accent)
	import type { Snippet } from 'svelte';

	let { tone = 'neutral', children }: { tone?: 'neutral' | 'accent'; children: Snippet } = $props();
</script>

<span class="tag {tone}" data-tag={tone}>{@render children()}</span>

<style>
	.tag {
		display: inline-flex;
		align-items: center;
		box-sizing: border-box;
		max-width: 100%;
		padding: 0 0.6em;
		border: 1px solid var(--readable-muted);
		border-radius: 999px;
		background: transparent;
		color: var(--readable-muted);
		font-size: var(--font-size-label);
		font-weight: var(--weight-regular);
		line-height: var(--line-body);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.accent {
		border-color: var(--reading-accent);
		color: var(--reading-accent);
	}
	@media (forced-colors: active) {
		.tag {
			border-color: CanvasText;
			color: CanvasText;
		}
	}
</style>
