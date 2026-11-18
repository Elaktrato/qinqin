<script lang="ts">
	// Test harness: an opener and a Sheet with paging callbacks.
	import Sheet from '../Sheet.svelte';
	let {
		onclose = () => {},
		onnext,
		onprev,
		onescape
	}: {
		onclose?: () => void;
		onnext?: () => void;
		onprev?: () => void;
		onescape?: () => void;
	} = $props();
	let open = $state(false);
</script>

<button type="button" onclick={() => (open = true)}>Look up</button>
<Sheet bind:open label="学习" {onclose} {onnext} {onprev}>
	<p>xué xí — to study</p>
	<input aria-label="Note" />
	{#if onescape}
		<!-- An inline action that takes Escape first (a rename, a confirmation). -->
		<input
			aria-label="Rename"
			onkeydown={(e) => {
				if (e.key !== 'Escape') return;
				e.preventDefault();
				onescape();
			}}
		/>
	{/if}
</Sheet>
<output data-testid="state">{open ? 'open' : 'closed'}</output>
