<script lang="ts">
	// A catalogue message with rich text: each `<tag>` of the message renders through the snippet of the same
	// name (`{#snippet link(text)}<a href="/sources">{text}</a>{/snippet}`); a tag without a snippet renders as
	// its text. Plain messages use `t()` instead.
	import type { Snippet } from 'svelte';
	import { tParts, type MessageArgs, type MessageKey } from '$lib/i18n';

	interface Props {
		key: MessageKey;
		args?: MessageArgs;
		[tag: string]: unknown;
	}

	let { key, args = {}, ...snippets }: Props = $props();

	const parts = $derived(tParts(key, args));

	function snippetFor(tag: string): Snippet<[string]> | null {
		const s = snippets[tag];
		if (typeof s === 'function') return s as Snippet<[string]>;
		if (import.meta.env.DEV) console.warn(`i18n: <Msg key="${key}"> has no snippet for <${tag}>`);
		return null;
	}
</script>

{#each parts as part, i (i)}{#if 'tag' in part}{@const s = snippetFor(part.tag)}{#if s}{@render s(part.text)}{:else}{part.text}{/if}{:else}{part.text}{/if}{/each}
