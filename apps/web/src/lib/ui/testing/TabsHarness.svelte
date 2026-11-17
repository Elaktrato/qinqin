<script lang="ts">
	// Test harness: in-page Tabs with a panel and a bound selection.
	import Tabs from '../Tabs.svelte';
	let selected = $state('overview');
	const tabs = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'week', label: 'Week' }
	];
</script>

<Tabs label="Views" {tabs} bind:selected>
	{#snippet panel(id)}Panel for {id}{/snippet}
</Tabs>
<output data-testid="bound">{selected}</output>
