<script lang="ts">
	import { useApp } from '$lib/context/context';
	import { offlineMessage } from './offlineState.svelte';

	// A polite live region that is always mounted, so a change of text is
	// announced; the sentence says it all (never colour alone). The app
	// context follows the browser's online events (record 0009).
	const app = useApp();
	const message = $derived(offlineMessage(app.offline, Date.now()));
</script>

<div class="offline" class:shown={message !== null} role="status">{message ?? ''}</div>

<style>
	.offline {
		text-align: center;
	}
	.offline.shown {
		padding: 0.5rem 1rem;
		background: var(--raised);
		border-bottom: 1px solid var(--hair);
	}
</style>
