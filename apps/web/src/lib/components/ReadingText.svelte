<script lang="ts">
	// A reading as text: the interface label ("Pinyin: ") inherits the document language, the value carries the
	// reading's own (zh-Latn-pinyin, zh-Bopo, ja, ja-Latn) so it is read in the right voice.
	// Hidden romanisation (#284): a reading of a type the workspace hides renders nothing, unless `reveal` (the
	// romanisation hint the learner asked for).
	import { readingLabel } from '$lib/languages/format';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import ToneText from '$lib/aids/ToneText.svelte';
	import Msg from '$lib/ui/Msg.svelte';
	import { readingLang } from '$lib/i18n/lang';

	let {
		type,
		value,
		language,
		reveal = false
	}: { type: string; value: string; language: string; reveal?: boolean } = $props();
	const roman = useRomanisation();
	const label = $derived(readingLabel(type));
	const lang = $derived(readingLang(type, language));
	const shown = $derived(reveal || roman.shows(type));
</script>

{#if !shown}{:else if label !== null}<Msg key="entry.reading.labelled" args={{ label, value }}
		>{#snippet reading(text: string)}<span {lang}><ToneText {type} value={text} /></span>{/snippet}</Msg
	>{:else}<span {lang}><ToneText {type} {value} /></span>{/if}
