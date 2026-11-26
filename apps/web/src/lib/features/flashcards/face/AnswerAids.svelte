<script lang="ts">
	// The visual aids of a card's answer (#212): the entry's picture (unless the Picture hint already shows it)
	// and, for the writing card, the parts of each character. Each is switched off in Settings > Study > Visual
	// aids and draws nothing when there is no data.
	import Anatomy from '$lib/aids/Anatomy.svelte';
	import EntryPicture from '$lib/aids/EntryPicture.svelte';
	import type { Entry } from '$lib/api/types';
	import { useCardHints } from './cardHints.svelte';

	let { entry, chars = [] }: { entry: Pick<Entry, 'id' | 'language'>; chars?: readonly string[] } = $props();
	const hints = useCardHints();
	const pictureShown = $derived(hints.visible.includes('picture'));
</script>

{#if !pictureShown}<EntryPicture entryId={entry.id} size={6} />{/if}
{#each chars as char (char)}
	<Anatomy {char} language={entry.language} heading={null} />
{/each}
