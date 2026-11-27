<script lang="ts">
	// Test double for WritingPad: the canvas cannot draw in jsdom. A reveal
	// signal completes the character as revealed, like the real pad.
	import type { CharOutcome } from '$lib/exercises/writing';
	import type { CharStrokes } from '$lib/writing/strokes';

	let {
		strokes,
		onComplete,
		revealSignal,
		label
	}: {
		strokes: CharStrokes;
		onComplete: (outcome: CharOutcome, hints: number) => void;
		revealSignal: number;
		hintSignal: number;
		label: string;
	} & Record<string, unknown> = $props();

	let seen = 0;
	$effect(() => {
		if (revealSignal > seen) {
			seen = revealSignal;
			onComplete({ char: strokes.char, mistakes: 0, strokes: strokes.medians.length, revealed: true }, 0);
		}
	});
</script>

<div class="pad" role="img" aria-label={label} data-card-input></div>
