<script lang="ts">
	// Test harness: a Tooltip that describes a text button.
	import Tooltip from '../Tooltip.svelte';
</script>

<Tooltip text="Saves to this device" describe>
	{#snippet children(tipId)}<button type="button" aria-describedby={tipId}>Save</button>{/snippet}
</Tooltip>
