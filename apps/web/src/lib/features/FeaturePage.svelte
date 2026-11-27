<script lang="ts">
	// The page of a core feature at /flashcards or /reader: the feature itself
	// while the user's switch is on, a notice when it is off (FeatureGate).
	// The route sets the fallback title; the feature's own views set theirs.
	import FeatureGate from './FeatureGate.svelte';
	import type { CoreFeature } from './index';

	let { feature, rest }: { feature: Pick<CoreFeature, 'id' | 'title' | 'component'>; rest: string } = $props();
</script>

<FeatureGate id={feature.id}>
	{#if feature.component}
		{@const Page = feature.component}
		<Page {rest} />
	{/if}
</FeatureGate>
