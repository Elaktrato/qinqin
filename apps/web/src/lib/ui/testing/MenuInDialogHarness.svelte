<script lang="ts">
	// Test harness: a Menu inside an open Dialog.
	import Dialog from '../Dialog.svelte';
	import Menu from '../Menu.svelte';
	import MenuItem from '../MenuItem.svelte';
	let { onclose = () => {} }: { onclose?: () => void } = $props();
	let open = $state(true);
</script>

<Dialog bind:open title="Edit deck" {onclose}>
	<Menu label="More actions" icon="more">
		<MenuItem>Rename</MenuItem>
	</Menu>
</Dialog>
