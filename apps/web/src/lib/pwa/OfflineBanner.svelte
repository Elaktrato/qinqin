<script lang="ts">
	import { onMount } from 'svelte';
	import { offline, offlineMessage, watchConnectivity } from './offlineState';

	// A polite live region that is always mounted, so a change of text is
	// announced; the sentence says it all (never colour alone).
	const message = $derived(offlineMessage($offline, Date.now()));

	onMount(() => watchConnectivity());
</script>

<div class="offline" class:shown={message !== null} role="status">{message ?? ''}</div>

<style>
	.offline {
		text-align: center;
	}
	.offline.shown {
		padding: 0.5rem 1rem;
		background: color-mix(in srgb, CanvasText 8%, Canvas);
		border-bottom: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
	}
</style>
