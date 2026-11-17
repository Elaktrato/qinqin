<script lang="ts">
	// A stand-in feature page for FeaturePage.dom.test.ts.
	let { rest }: { rest: string } = $props();
</script>

<p data-testid="stub">rest={rest}</p>
