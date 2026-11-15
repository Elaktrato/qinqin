<script lang="ts">
	import { QUIET_ZONE, qrDrawing } from './qrMatrix';

	// The QR code as SVG rects (no injected markup). The text alternative is
	// the secret the page shows beside it.
	let { text, label = 'QR code for your authenticator app' }: { text: string; label?: string } = $props();

	const drawing = $derived(qrDrawing(text));
	const box = $derived(drawing.size + QUIET_ZONE * 2);
</script>

<svg
	class="qr"
	viewBox="0 0 {box} {box}"
	width="220"
	height="220"
	role="img"
	aria-label={label}
	shape-rendering="crispEdges"
>
	<rect width={box} height={box} fill="#fff" />
	{#each drawing.runs as run (run.y * 1000 + run.x)}
		<rect x={run.x + QUIET_ZONE} y={run.y + QUIET_ZONE} width={run.w} height="1" fill="#000" />
	{/each}
</svg>

<style>
	.qr {
		display: block;
		max-width: 100%;
		height: auto;
		border: 1px solid var(--border, #d4d4d8);
	}
</style>
