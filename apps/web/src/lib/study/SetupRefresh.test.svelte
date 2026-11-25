<script lang="ts">
	// Test stub: reads a workspace's setup and refreshes it from an effect, as the
	// study modal, the widget and the decks pages do.
	import type { StudySetups } from './setupStore.svelte';

	let { store }: { store: StudySetups } = $props();
	$effect(() => void store.refresh(4));
</script>

<p>{store.of(4).setup.newLimit}</p>
