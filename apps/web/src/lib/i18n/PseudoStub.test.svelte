<script lang="ts">
	// Test stub for pseudo.dom.test.ts: one catalogue text, one hard-coded English text, hidden text.
	import { t } from './index';

	let { word }: { word: string } = $props();
</script>

<h1>{t('app.name')}</h1>
<p>Hard coded words</p>
<p>{word}</p>
<span aria-hidden="true">Decorative text</span>
