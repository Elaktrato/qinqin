<script lang="ts">
	// The reviewed text (#103): every placed annotation is a button that
	// opens its note in the margin (wide) or the sheet (phone). The class
	// comes from the closed kind only, never from model text; the open mark
	// is tinted. The text is exact (pre-wrap, no added whitespace).
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import { segments, type Placed } from './anchor';
	import { annotationKind } from './review';
	import type { Annotation } from './types';

	let {
		text,
		placed,
		annotations,
		openId,
		onopen
	}: {
		text: string;
		placed: Placed[];
		annotations: Annotation[];
		openId: string | null;
		onopen: (id: string | null) => void;
	} = $props();

	let buttons: Record<string, HTMLButtonElement | undefined> = {};

	const runs = $derived(segments(text, placed));

	function kindOf(id: string): 'mistake' | 'suggestion' {
		return annotationKind(annotations.find((a) => a.id === id));
	}

	function kindLabel(id: string): string {
		return kindOf(id) === 'suggestion' ? t('journal.kind.suggestion') : t('journal.kind.mistake');
	}

	/** focusAnnotation: put focus on a mark and bring it into view (used by the notes list). */
	export async function focusAnnotation(id: string): Promise<void> {
		await tick();
		const button = buttons[id];
		button?.focus();
		button?.scrollIntoView({ block: 'nearest' });
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || openId === null) return;
		event.preventDefault();
		event.stopPropagation();
		const id = openId;
		onopen(null);
		buttons[id]?.focus();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="review-text" onkeydown={keydown}>
	<!-- No whitespace between the runs: the paragraph is pre-wrap and must show the text exactly. -->
	<p class="text">{#each runs as run, i (i)}{#if run.annotationId}{@const id = run.annotationId}{@const kind = kindOf(id)}<button
				type="button"
				id={`mark-${id}`}
				class="mark {kind}"
				class:open={openId === id}
				aria-expanded={openId === id}
				aria-controls={openId === id ? `correction-${id}` : undefined}
				bind:this={buttons[id]}
				onclick={() => onopen(id)}>{run.text}<span class="visually-hidden"
					> {t('journal.kind.markSuffix', { kind: kindLabel(id) })}</span
				></button
			>{:else}{run.text}{/if}{/each}</p>
</div>

<style>
	.review-text {
		width: 100%;
	}
	.text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.9;
		font-size: 1.1rem;
		margin: 0.5rem 0;
	}
	.mark {
		display: inline;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		white-space: pre-wrap;
		text-align: inherit;
		cursor: pointer;
	}
	.mistake {
		text-decoration: underline wavy var(--grade-again) 1.5px;
		text-underline-offset: 0.25em;
	}
	.suggestion {
		text-decoration: underline dotted var(--grade-easy) 2px;
		text-underline-offset: 0.25em;
	}
	.open {
		background: var(--selected-wash);
	}
	.mark:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	@media (forced-colors: active) {
		.mistake,
		.suggestion {
			text-decoration-color: CanvasText;
		}
		.open {
			background: Highlight;
			color: HighlightText;
		}
	}
</style>
