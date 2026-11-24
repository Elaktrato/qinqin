<script lang="ts">
	// The "AI-written" mark of a sentence an AI wrote (#186): on the entry page
	// and on every card that shows a sentence. `label` replaces the short text
	// (the entry page names the model and provider). Nothing for other sentences.
	import { t } from '$lib/i18n';
	import { aiMark } from '$lib/api/examples';

	let { ai, label }: { ai: unknown; label?: string } = $props();
	const mark = $derived(aiMark(ai));
</script>

{#if mark !== null}<span class="ai-tag">{label ?? t('entry.examples.aiWritten')}</span>{/if}

<style>
	.ai-tag {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: var(--weight-medium);
		color: var(--readable-muted);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0 var(--space-1);
	}
</style>
