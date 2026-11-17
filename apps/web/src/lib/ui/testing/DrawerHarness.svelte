<script lang="ts">
	// Test harness: an opener and a Drawer with two links and a button.
	import Drawer from '../Drawer.svelte';
	let { onclose = () => {}, initialFocus, dir }: { onclose?: () => void; initialFocus?: string; dir?: 'rtl' } = $props();
	let open = $state(false);
</script>

<div {dir}>
	<button type="button" onclick={() => (open = true)}>Open menu</button>
	<Drawer bind:open label="Menu" {onclose} {initialFocus}>
		<a href="/one">One</a>
		<a href="/two" class="two">Two</a>
		<button type="button">Last</button>
	</Drawer>
</div>
<output data-testid="state">{open ? 'open' : 'closed'}</output>
