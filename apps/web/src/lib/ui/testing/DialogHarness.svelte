<script lang="ts">
	// Test harness: an opener and a Dialog with a field and two actions.
	import Dialog from '../Dialog.svelte';
	let {
		onclose = () => {},
		initialFocus,
		dismissible,
		startOpen = false,
		describedBy
	}: {
		onclose?: () => void;
		initialFocus?: string;
		dismissible?: boolean;
		startOpen?: boolean;
		describedBy?: string;
	} = $props();
	// svelte-ignore state_referenced_locally
	let open = $state(startOpen);
</script>

<button type="button" onclick={() => (open = true)}>Open</button>
<Dialog bind:open title="Delete deck" description="This cannot be undone." {onclose} {initialFocus} {dismissible} {describedBy}>
	<p id="harness-what">Three decks go.</p>
	<input aria-label="Type the name" />
	{#snippet actions()}
		<button type="button" class="keep" onclick={() => (open = false)}>Keep</button>
		<button type="button">Delete</button>
	{/snippet}
</Dialog>
<output data-testid="state">{open ? 'open' : 'closed'}</output>
