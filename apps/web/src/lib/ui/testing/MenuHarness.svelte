<script lang="ts">
	// Test harness: an icon menu with plain, radio and link items, and a text menu.
	import Menu from '../Menu.svelte';
	import MenuItem from '../MenuItem.svelte';
	let { picked = (_: string) => {}, open = $bindable(false) }: { picked?: (v: string) => void; open?: boolean } = $props();
	let size = $state('m');
</script>

<button type="button">Before</button>
<Menu label="More actions" icon="more" bind:open>
	<MenuItem onselect={() => picked('rename')}>Rename</MenuItem>
	<MenuItem onselect={() => picked('copy')}>Copy</MenuItem>
	<MenuItem separator />
	<MenuItem checked={size === 's'} onselect={() => (size = 's')}>Small</MenuItem>
	<MenuItem checked={size === 'm'} onselect={() => (size = 'm')}>Medium</MenuItem>
	<MenuItem href="/settings">Settings</MenuItem>
</Menu>
<Menu text="Chinese" label="Workspace" menuLabel="Workspaces" align="start">
	<MenuItem onselect={() => picked('ja')}>Japanese</MenuItem>
</Menu>
<output data-testid="size">{size}</output>
