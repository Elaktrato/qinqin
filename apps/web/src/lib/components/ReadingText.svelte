<script lang="ts">
	// A reading as text: the interface label ("Pinyin: ") inherits the document language, the value carries the
	// reading's own (zh-Latn-pinyin, zh-Bopo, ja, ja-Latn) so it is read in the right voice.
	import { readingLabel } from '$lib/languages/format';
	import Msg from '$lib/i18n/Msg.svelte';
	import { readingLang } from '$lib/i18n/lang';

	let { type, value, language }: { type: string; value: string; language: string } = $props();
	const label = $derived(readingLabel(type));
	const lang = $derived(readingLang(type, language));
</script>

{#if label !== null}<Msg key="entry.reading.labelled" args={{ label, value }}
		>{#snippet reading(text: string)}<span {lang}>{text}</span>{/snippet}</Msg
	>{:else}<span {lang}>{value}</span>{/if}
