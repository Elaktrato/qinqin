<script lang="ts">
	// Test double for the grammar review round inside a session (#181): one button that ends it with one run.
	let { onDone }: { onDone?: (runs: unknown[]) => void } & Record<string, unknown> = $props();
	const run = { id: 'g1', workspaceId: 1, ts: new Date().toISOString(), at: Date.now(), point: 'p:l', packId: 'p', lessonId: 'l', mode: 'review', score: 3, total: 3 };
</script>

<h1>Grammar review</h1>
<button type="button" onclick={() => onDone?.([run])}>Finish grammar</button>
