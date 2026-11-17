<script lang="ts">
	// Test harness: an opener and a Sheet with paging callbacks.
	import Sheet from '../Sheet.svelte';
	let {
		onclose = () => {},
		onnext,
		onprev
	}: { onclose?: () => void; onnext?: () => void; onprev?: () => void } = $props();
	let open = $state(false);
</script>

<button type="button" onclick={() => (open = true)}>Look up</button>
<Sheet bind:open label="学习" {onclose} {onnext} {onprev}>
	<p>xué xí — to study</p>
	<input aria-label="Note" />
</Sheet>
<output data-testid="state">{open ? 'open' : 'closed'}</output>
