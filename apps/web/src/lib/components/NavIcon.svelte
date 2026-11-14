<script lang="ts">
	import type { NavIconName } from './navIcons';

	// Hand-drawn line glyphs for the shell navigation (our own art, no
	// icon library). Always decorative: the visible label next to the
	// glyph is the accessible name, so screen readers hear it once.
	let { name, size = 20 }: { name: NavIconName; size?: number } = $props();

	/** gear returns a toothed ring outline centred on the 24×24 box. */
	function gear(teeth: number, inner: number, outer: number): string {
		const step = 360 / teeth;
		const points: string[] = [];
		const at = (r: number, deg: number): string => {
			const rad = ((deg - 90) * Math.PI) / 180;
			return `${(12 + r * Math.cos(rad)).toFixed(2)},${(12 + r * Math.sin(rad)).toFixed(2)}`;
		};
		for (let i = 0; i < teeth; i++) {
			const mid = i * step;
			points.push(at(inner, mid - step * 0.32), at(outer, mid - step * 0.18));
			points.push(at(outer, mid + step * 0.18), at(inner, mid + step * 0.32));
		}
		return points.join(' ');
	}

	const gearOutline = gear(8, 7, 9.5);
</script>

<svg
	class="nav-icon"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'search'}
		<circle cx="10.5" cy="10.5" r="6.5" />
		<path d="M15.5 15.5 20.5 20.5" />
	{:else if name === 'map'}
		<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
		<path d="M9 4v13.5M15 6.5V20" />
	{:else if name === 'cards'}
		<path d="M8 6.5V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-1.5" />
		<rect x="3" y="6.5" width="14.5" height="14.5" rx="2" />
		<path d="M7 12h6.5M7 15.5h4" />
	{:else if name === 'book'}
		<path d="M12 6.5C10.3 5 7.8 4.5 3 4.5v14c4.8 0 7.3.5 9 2 1.7-1.5 4.2-2 9-2v-14c-4.8 0-7.3.5-9 2z" />
		<path d="M12 6.5v14" />
	{:else if name === 'books'}
		<rect x="3.5" y="4" width="4.5" height="16" rx="1" />
		<rect x="8" y="6.5" width="4.5" height="13.5" rx="1" />
		<path d="m14.3 6.9 3.9-1.2 3.6 12.9-3.9 1.2z" />
		<path d="M3.5 8h4.5M8 10h4.5" />
	{:else if name === 'gear'}
		<polygon points={gearOutline} />
		<circle cx="12" cy="12" r="3" />
	{:else if name === 'signin'}
		<path d="M11 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
		<path d="M3.5 12H13.5M9.5 8l4 4-4 4" />
	{:else if name === 'signout'}
		<path d="M13 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
		<path d="M10.5 12H20.5M16.5 8l4 4-4 4" />
	{:else}
		<rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
		<rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
		<rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
		<rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
	{/if}
</svg>

<style>
	.nav-icon {
		flex: none;
		display: block;
	}
</style>
