<script lang="ts">
	// Test harness: an opener and a Dialog with a field and two actions.
	import Dialog from '../Dialog.svelte';
	let { onclose = () => {}, initialFocus }: { onclose?: () => void; initialFocus?: string } = $props();
	let open = $state(false);
</script>

<button type="button" onclick={() => (open = true)}>Open</button>
<Dialog bind:open title="Delete deck" description="This cannot be undone." {onclose} {initialFocus}>
	<input aria-label="Type the name" />
	{#snippet actions()}
		<button type="button" class="keep" onclick={() => (open = false)}>Keep</button>
		<button type="button">Delete</button>
	{/snippet}
</Dialog>
<output data-testid="state">{open ? 'open' : 'closed'}</output>
