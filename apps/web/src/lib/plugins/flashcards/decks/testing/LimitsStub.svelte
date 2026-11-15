<script lang="ts">
	// Test double for 4b's per-deck limits editor (DeckLimitsSlot.ts).
	let { deckId, deckName }: { deckId: string; deckName: string } = $props();
</script>

<p data-testid="limits-stub">limits for {deckId} {deckName}</p>
