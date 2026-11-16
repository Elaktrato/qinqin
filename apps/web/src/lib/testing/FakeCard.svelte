<script lang="ts">
	// Test double for a flashcard component: one button that finishes the card.
	let { onDone }: { onDone: (result: { suggested: number; meta: Record<string, unknown> }) => void } & Record<
		string,
		unknown
	> = $props();
</script>

<button type="button" onclick={() => onDone({ suggested: 3, meta: {} })}>Show answer</button>
