<script lang="ts">
	// Test harness: a "page" that publishes a phone title and page actions
	// the way a route does (during its initialisation).
	import { setFrameTitle, setPageActions } from '../pageFrame.svelte';

	let { title, word = $bindable('学习') }: { title?: boolean; word?: string } = $props();

	// Decided once, at initialisation, as a route would.
	// svelte-ignore state_referenced_locally
	if (title) setFrameTitle(() => word);
	setPageActions(actions);
</script>

{#snippet actions()}<button type="button">Add to deck</button>{/snippet}
<p>page</p>
