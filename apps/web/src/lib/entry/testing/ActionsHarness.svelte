<script lang="ts">
	// Test harness: renders the page's phone-bar actions, as PhoneBar does.
	import { useApp } from '$lib/context/context';
	const app = useApp();
</script>

{#if app.frame.actions}{@render app.frame.actions()}{/if}
