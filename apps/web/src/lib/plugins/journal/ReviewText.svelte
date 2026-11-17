<script lang="ts">
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import { segments, type Placed } from './anchor';
	import { annotationCategory } from './editorLogic';
	import type { Annotation } from './types';

	let {
		text,
		placed,
		annotations
	}: { text: string; placed: Placed[]; annotations: Annotation[] } = $props();

	let openId = $state<string | null>(null);
	let popover = $state<HTMLDivElement>();
	const buttons: Record<string, HTMLButtonElement | undefined> = {};

	const runs = $derived(segments(text, placed));
	const open = $derived(annotations.find((a) => a.id === openId) ?? null);

	function toggle(id: string): void {
		openId = openId === id ? null : id;
	}

	/** Opens an annotation's popover and puts focus on its underlined words. */
	export async function focusAnnotation(id: string): Promise<void> {
		if (!buttons[id]) {
			// Overlapping or missing: nothing to focus in the text.
			openId = id;
			await tick();
			popover?.focus();
			return;
		}
		openId = id;
		await tick();
		buttons[id]?.focus();
		buttons[id]?.scrollIntoView({ block: 'nearest' });
	}

	function close(): void {
		const id = openId;
		openId = null;
		if (id) buttons[id]?.focus();
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && openId) {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="review-text" onkeydown={keydown}>
	<!-- No whitespace between the runs: the paragraph is pre-wrap and must show the text exactly. -->
	<p class="text">{#each runs as run, i (i)}{#if run.annotationId}{@const id = run.annotationId}{@const a = annotations.find((x) => x.id === id)}<button type="button" class="annot {annotationCategory(a?.category ?? '')}" bind:this={buttons[id]} aria-expanded={openId === id} aria-controls={openId === id ? 'annotation-popover' : undefined} onclick={() => toggle(id)}>{run.text}</button>{:else}{run.text}{/if}{/each}</p>

	{#if open}
		<div class="popover" id="annotation-popover" bind:this={popover} tabindex="-1" role="group" aria-label={t('journal.review.correction')}>
			<p class="cat">{open.category}</p>
			<p><span class="label">{t('journal.review.youWrote')}</span> <span class="quote">{open.quote}</span></p>
			<p><span class="label">{t('journal.review.correction')}</span> <strong class="fix">{open.correction}</strong></p>
			<p class="why">{open.explanation}</p>
			<button type="button" class="secondary" onclick={close}>{t('journal.review.close')}</button>
		</div>
	{/if}
</div>

<style>
	.text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.9;
		font-size: 1.1rem;
		margin: 0.5rem 0;
	}

	.annot {
		font: inherit;
		color: inherit;
		background: transparent;
		border: 0;
		padding: 0;
		margin: 0;
		cursor: pointer;
		text-decoration: underline wavy;
		text-decoration-thickness: 2px;
		text-underline-offset: 0.25em;
		min-height: 0;
		white-space: pre-wrap;
		text-align: inherit;
	}

	.annot[aria-expanded='true'] {
		background: color-mix(in srgb, currentColor 14%, transparent);
	}

	.annot:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	/* The category's line colour, from the theme (design §6 correction marks:
	   mistakes in the grade colours); the wavy line and the category named in
	   the popover carry the meaning without colour. */
	.grammar {
		text-decoration-color: var(--grade-again);
	}

	.word-choice {
		text-decoration-color: var(--grade-hard);
	}

	.spelling {
		text-decoration-color: var(--accent);
	}

	.style {
		text-decoration-color: var(--grade-easy);
	}

	.other {
		text-decoration-color: var(--muted);
	}

	.popover {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		margin: 0.5rem 0 1rem;
		background: color-mix(in srgb, currentColor 5%, transparent);
	}

	.popover p {
		margin: 0.25rem 0;
		overflow-wrap: anywhere;
	}

	.cat {
		text-transform: capitalize;
		font-size: 0.85rem;
		color: var(--readable-muted);
	}

	.label {
		font-size: 0.85rem;
		color: var(--readable-muted);
		margin-right: 0.4rem;
	}

	.quote {
		text-decoration: line-through;
		color: var(--readable-muted);
	}

	.why {
		white-space: pre-wrap;
	}
</style>
