<script lang="ts">
	// The Practice area (the drills); FeaturePage shows it or its switched-off notice.
	import { page } from '$app/state';
	import { pageTitle } from '$lib/routing/pageTitle';
	import FeaturePage from '$lib/features/FeaturePage.svelte';
	import { PRACTICE_ID, featureById } from '$lib/features';

	const feature = featureById(PRACTICE_ID);
</script>

<!-- The feature's own view sets its title; this one shows until it does. -->
<svelte:head>
	<title>{pageTitle(feature.title)}</title>
</svelte:head>

<FeaturePage {feature} rest={page.params.rest ?? ''} />
