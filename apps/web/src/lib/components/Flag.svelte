<script lang="ts">
	import { flagFor, languageLabel } from '$lib/languages';

	// Hand-drawn, deliberately simple flags: emoji flags do not render on
	// Windows, and third-party flag art would raise licensing questions.
	// The flag is labelled with the language name, never the country.
	// `decorative` hides the flag from assistive tech when the language
	// name is already printed next to it.
	let {
		code,
		size = 16,
		decorative = false
	}: { code: string; size?: number; decorative?: boolean } = $props();

	const kind = $derived(flagFor(code));
	const label = $derived(languageLabel(code));

	/** star returns a five-pointed star polygon centred at (cx, cy). */
	function star(cx: number, cy: number, r: number, rotation = 0): string {
		const points: string[] = [];
		for (let i = 0; i < 10; i++) {
			const radius = i % 2 === 0 ? r : r * 0.382;
			const angle = ((rotation - 90 + i * 36) * Math.PI) / 180;
			points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
		}
		return points.join(' ');
	}

	const bigStar = star(5, 5, 3);
	const smallStars = [
		star(10, 2, 1, 23),
		star(12, 4, 1, 46),
		star(12, 7, 1, 70),
		star(10, 9, 1, 21)
	];
</script>

<svg
	class="flag"
	role={decorative ? undefined : 'img'}
	aria-label={decorative ? undefined : label}
	aria-hidden={decorative ? 'true' : undefined}
	viewBox="0 0 30 20"
	width={Math.round(size * 1.5)}
	height={size}
>
	{#if !decorative}
		<title>{label}</title>
	{/if}
	{#if kind === 'cn'}
		<rect width="30" height="20" fill="#de2910" />
		<polygon points={bigStar} fill="#ffde00" />
		{#each smallStars as points, i (i)}
			<polygon {points} fill="#ffde00" />
		{/each}
	{:else if kind === 'jp'}
		<rect width="30" height="20" fill="#ffffff" />
		<circle cx="15" cy="10" r="6" fill="#bc002d" />
		<rect x="0.5" y="0.5" width="29" height="19" fill="none" stroke="#000" stroke-opacity="0.2" />
	{:else if kind === 'es'}
		<rect width="30" height="20" fill="#aa151b" />
		<rect y="5" width="30" height="10" fill="#f1bf00" />
	{:else}
		<g fill="none" stroke="currentColor" stroke-width="1.4">
			<circle cx="15" cy="10" r="8.3" />
			<ellipse cx="15" cy="10" rx="3.6" ry="8.3" />
			<path d="M6.7 10h16.6" />
		</g>
	{/if}
</svg>

<style>
	.flag {
		display: inline-block;
		flex: none;
		vertical-align: middle;
		border-radius: 2px;
	}
</style>
