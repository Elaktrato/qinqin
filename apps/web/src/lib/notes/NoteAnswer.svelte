<script lang="ts">
	// The learner's note on a revealed flashcard. Plain text only: text
	// interpolation, never HTML.
	let { text }: { text: string | undefined } = $props();
</script>

{#if text}
	<aside class="note-answer" role="note" aria-label="Your note">
		<h3>Your note</h3>
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
		opacity: 0.75;
	}
	.note-text {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
