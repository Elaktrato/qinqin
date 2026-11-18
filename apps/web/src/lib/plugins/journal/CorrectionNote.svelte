<script lang="ts">
	// One correction in the margin or the phone sheet (#103): collapsed it is
	// one line naming kind, category and the change; expanded it shows the
	// category, what was written, the fix in --readable-good and why. The
	// model's text is rendered as text only. The kind is a shape (filled dot
	// vs ring) plus the visually hidden word, never colour alone.
	import { t } from '$lib/i18n';
	import { categoryLabel, type Correction } from './corrections';

	let {
		correction,
		open,
		onopen,
		explanationLang,
		studyLang,
		id
	}: {
		correction: Correction;
		open: boolean;
		onopen: (id: string | null) => void;
		explanationLang: string;
		studyLang: string;
		id: string;
	} = $props();

	const kindLabel = $derived(
		correction.kind === 'suggestion' ? t('journal.kind.suggestion') : t('journal.kind.mistake')
	);
	const category = $derived(categoryLabel(correction.annotation.category));
</script>

<button
	{id}
	type="button"
	class="note"
	class:open
	aria-expanded={open}
	onclick={() => onopen(open ? null : correction.annotation.id)}
>
	<span class="visually-hidden">{kindLabel}: </span>
	<span class="category"
		><span class="dot" data-shape={correction.kind === 'suggestion' ? 'ring' : 'filled'} aria-hidden="true"
		></span>{category}</span
	>
	{#if open}
		<span class="fix"
			><span class="visually-hidden">{t('journal.review.youWrote')} </span><s lang={studyLang}
				>{correction.annotation.quote}</s
			><span class="arrow" aria-hidden="true">→</span><span class="visually-hidden"
				>{t('journal.review.correction')} </span
			><b lang={studyLang}>{correction.annotation.correction}</b></span
		>
		<span class="why" lang={explanationLang}>{correction.annotation.explanation}</span>
	{:else}
		<span class="one-line"
			><s lang={studyLang}>{correction.annotation.quote}</s><span class="arrow" aria-hidden="true">→</span
			><b lang={studyLang}>{correction.annotation.correction}</b></span
		>
	{/if}
</button>

<style>
	.note {
		display: grid;
		gap: var(--space-1);
		width: 100%;
		padding: var(--space-2);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		cursor: pointer;
		border-bottom: 1px solid var(--hair);
	}
	.note:hover {
		background: var(--raised);
	}
	.note.open {
		background: var(--raised);
	}
	.note:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.category {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	.dot {
		flex: none;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
	}
	.dot[data-shape='filled'] {
		background: var(--grade-again);
	}
	.dot[data-shape='ring'] {
		border: 1px solid var(--grade-easy);
	}
	.one-line,
	.fix {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fix {
		color: var(--readable-good);
		white-space: normal;
	}
	.one-line s,
	.fix s {
		color: var(--readable-muted);
	}
	.arrow {
		margin-inline: var(--space-1);
		color: var(--readable-muted);
	}
	.fix b {
		font-weight: var(--weight-medium);
	}
	.why {
		display: block;
		color: var(--readable-muted);
		line-height: var(--line-body);
		overflow-wrap: anywhere;
	}
	@media (forced-colors: active) {
		.note {
			outline: 1px solid CanvasText;
		}
		.dot[data-shape='filled'] {
			background: CanvasText;
		}
		.dot[data-shape='ring'] {
			border-color: CanvasText;
		}
	}
</style>
