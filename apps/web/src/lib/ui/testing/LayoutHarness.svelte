<script lang="ts">
	// Test harness: two Sections (one with actions) inside a Panel, and Chips.
	import Chip from '../Chip.svelte';
	import Panel from '../Panel.svelte';
	import Section from '../Section.svelte';
</script>

<Panel data-testid="panel">
	<Section title="Meanings">
		<p>to study</p>
	</Section>
	<Section title="Characters" level={3}>
		{#snippet actions()}<button type="button">Edit</button>{/snippet}
		<p>学 习</p>
	</Section>
	<Section><p>untitled</p></Section>
</Panel>
<Chip>HSK 1</Chip>
<Chip tone="accent">Top 500</Chip>
<Chip tone="good">In 2 decks</Chip>
