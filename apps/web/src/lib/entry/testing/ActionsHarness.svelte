<script lang="ts">
	// Test harness: renders the page's phone-bar actions, as PhoneBar does.
	import { pageFrame } from '$lib/frame/pageFrame.svelte';
</script>

{#if pageFrame.actions}{@render pageFrame.actions()}{/if}
