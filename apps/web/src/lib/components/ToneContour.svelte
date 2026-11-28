<script lang="ts">
	// A tone's contour (the Chao tone letters as a line; the neutral tone a dot), drawn in the current colour at the
	// text's size. Decorative: the tone is named in text beside it. The tone card's answer and the tone-pair drill.
	import { TONE_CONTOURS, type Tone } from '$lib/exercises/tones';

	let { tone }: { tone: Tone } = $props();
</script>

<svg viewBox="0 0 100 100" aria-hidden="true" class="tone-contour" data-tone={tone}>
	{#if tone === 5}<circle cx="50" cy="56" r="9" />{:else}<path d={TONE_CONTOURS[tone]} />{/if}
</svg>

<style>
	.tone-contour {
		width: 1.25em;
		height: 1.25em;
		fill: none;
		stroke: currentColor;
		stroke-width: 10;
		stroke-linecap: round;
		flex: none;
	}

	.tone-contour circle {
		fill: currentColor;
		stroke: none;
	}
</style>
