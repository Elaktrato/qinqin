<script lang="ts">
	// The provisional qinqin logo (src/lib/assets/qinqin-logo.svg is the single
	// source; the favicon is generated from the same file). It paints with the
	// surrounding text colour, so it follows the app's light and dark themes.
	import source from '$lib/assets/qinqin-logo.svg?raw';

	let { size = 28 }: { size?: number } = $props();

	const outline = /<path d="([^"]+)"/.exec(source)?.[1] ?? '';
</script>

<svg
	class="logo"
	viewBox="0 0 1080 1080"
	width={size}
	height={size}
	fill="currentColor"
	aria-hidden="true"
	focusable="false"><path d={outline} /></svg
>

<style>
	.logo {
		display: block;
		flex: none;
	}
</style>
