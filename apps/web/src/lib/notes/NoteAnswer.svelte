<script lang="ts">
	// The learner's note on a revealed flashcard. Plain text only: text
	// interpolation, never HTML.
	import { t } from '$lib/i18n';

	let { text }: { text: string | undefined } = $props();
</script>

{#if text}
	<aside class="note-answer" role="note" aria-label={t('notes.title')}>
		<h3>{t('notes.title')}</h3>
		<p class="note-text">{text}</p>
	</aside>
{/if}

<style>
	.note-answer {
		margin-top: 1rem;
		padding: 0.6rem 0.85rem;
		border-left: 3px solid color-mix(in srgb, currentColor 35%, transparent);
		background: color-mix(in srgb, currentColor 5%, transparent);
		border-radius: 0.3rem;
	}
	h3 {
		margin: 0 0 0.25rem;
		font-size: 0.85rem;
		color: var(--readable-muted);
	}
	.note-text {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
