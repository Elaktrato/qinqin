<script lang="ts">
	// The reader core feature; FeaturePage shows it or its switched-off notice.
	import { page } from '$app/state';
	import { pageTitle } from '$lib/pageTitle';
	import FeaturePage from '$lib/features/FeaturePage.svelte';
	import { READER_ID, featureById } from '$lib/features';

	const feature = featureById(READER_ID);
</script>

<!-- The feature's own views set their titles; this one shows until they do. -->
<svelte:head>
	<title>{pageTitle(feature.title)}</title>
</svelte:head>

<FeaturePage {feature} rest={page.params.rest ?? ''} />
