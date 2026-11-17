<script lang="ts">
	// Test harness: Field with a bound value echoed back.
	import Field from '../Field.svelte';
	let value = $state('');
</script>

<Field label="Word" bind:value />
<output data-testid="echo">{value}</output>
