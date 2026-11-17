<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import type { IconName } from '$lib/ui/icons/lucide';
	import type { NavIconName } from './navIcons';

	// The shell navigation's glyphs, drawn from the icon set (lib/ui/Icon,
	// #98). Always decorative: the visible label next to the glyph is the
	// accessible name, so screen readers hear it once. The frame rework (#99)
	// uses Icon directly and retires this mapping.
	let { name, size = 20 }: { name: NavIconName; size?: number } = $props();

	const GLYPH: Record<NavIconName, IconName> = {
		search: 'search',
		map: 'map',
		chart: 'stats',
		cards: 'study',
		book: 'reader',
		books: 'library',
		gear: 'settings',
		signin: 'sign-in',
		signout: 'sign-out',
		palette: 'palette',
		plugin: 'plugin'
	};
</script>

<Icon name={GLYPH[name]} {size} class="nav-icon" />
