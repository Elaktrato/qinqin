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
	/* The lighter note of the open page (#101, design §9): a warn start line,
	   no fill; the label in --text, the note in --readable-muted. */
	.note-answer {
		padding-inline-start: var(--space-3);
		border-inline-start: 2px solid color-mix(in srgb, var(--warn) 60%, transparent);
		text-align: start;
	}
	h3 {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		color: var(--text);
	}
	.note-text {
		margin: 0;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	@media (forced-colors: active) {
		.note-answer {
			border-inline-start-color: CanvasText;
		}
	}
</style>
