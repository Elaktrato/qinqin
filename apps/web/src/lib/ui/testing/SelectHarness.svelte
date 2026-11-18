<script lang="ts">
	import Select from '../Select.svelte';

	let value = $state('b');
	const options = [
		{ value: 'a', label: 'Level' },
		{ value: 'b', label: 'Grade' },
		{ value: 'c', label: 'Frequency' }
	];
</script>

<Select label="Group by" bind:value {options} />
<p data-testid="echo">{value}</p>
