<script lang="ts">
	import { t } from '$lib/i18n';
	import { onMount } from 'svelte';
	import type { Entry, Sentence } from '$lib/api/types';
	import ClozeChoice from '$lib/components/ClozeChoice.svelte';
	import type { CardResult, FlowItem } from '$lib/study/cardFlow';
	import { normalizeAnswer, suggestClozeGrade, type ClozeMode, type ClozePrompt } from '$lib/study/cloze';

	interface Props {
		item: FlowItem;
		entry: Entry;
		sentence: Sentence;
		prompt: ClozePrompt;
		mode: ClozeMode;
		/** The shuffled choices (answer included) for the choose mode. */
		choices: string[];
		/** Normalised accepted answers for the type mode. */
		accepted: ReadonlySet<string>;
		language: string;
		/** The runner owns it: true once the learner finished the card. */
		done: boolean;
		onDone: (result: CardResult) => void;
	}

	let { sentence, prompt, mode, choices, accepted, language, done, onDone }: Props = $props();

	let typed = $state('');
	let field = $state<HTMLInputElement | null>(null);
	let outcome = $state<'right' | 'wrong' | 'gaveUp' | null>(null);

	onMount(() => {
		if (mode === 'type') field?.focus();
	});

	function finish(result: 'right' | 'wrong' | 'gaveUp'): void {
		if (outcome !== null) return;
		outcome = result;
		onDone({
			suggested: suggestClozeGrade({ correct: result === 'right', gaveUp: result === 'gaveUp' }),
			meta: result === 'right' ? {} : { mistakes: 1 }
		});
	}

	function check(): void {
		if (typed.trim() === '') return;
		finish(accepted.has(normalizeAnswer(typed)) ? 'right' : 'wrong');
	}

	function onFieldKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		// An IME confirming a candidate also sends Enter (keyCode 229).
		if (event.isComposing || event.keyCode === 229) return;
		event.preventDefault();
		check();
	}
</script>

{#snippet gap(surface: string | undefined)}
	<span class="gap" class:right={outcome === 'right'} class:wrong={outcome === 'wrong' || outcome === 'gaveUp'}
		><span class="sr-only">{t('flashcards.card.blank')}</span>{done ? (surface ?? prompt.answer) : '＿＿'}</span
	>
{/snippet}

{#if mode === 'choose'}
	<ClozeChoice
		before={prompt.before}
		after={prompt.after}
		{choices}
		answer={prompt.answer}
		{language}
		onResult={(r) => finish(r.correct ? 'right' : 'wrong')}
	/>
{:else}
	<p class="sentence" lang={language}>
		{#each prompt.before as part, i (i)}{#if typeof part === 'string'}{part}{:else}{@render gap(part.answer)}{/if}{/each}{@render gap(undefined)}{#each prompt.after as part, i (i)}{#if typeof part === 'string'}{part}{:else}{@render gap(part.answer)}{/if}{/each}
	</p>

	<div class="entry">
		<label for="cloze-answer">{t('flashcards.card.typeWord')}</label>
		<input
			id="cloze-answer"
			type="text"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			lang={language}
			bind:this={field}
			bind:value={typed}
			disabled={done}
			onkeydown={onFieldKeydown}
		/>
	</div>

	{#if !done}
		<div class="actions">
			<button type="button" class="primary" onclick={check} disabled={typed.trim() === ''}>{t('flashcards.card.check')}</button>
			<button type="button" class="secondary" onclick={() => finish('gaveUp')}>{t('flashcards.card.showAnswer')}</button>
		</div>
	{/if}

	<p class="feedback" class:bad={outcome === 'wrong' || outcome === 'gaveUp'} role="status" aria-live="polite">
		{#if outcome === 'right'}
			{t('flashcards.card.correct')}
		{:else if outcome === 'wrong'}
			{t('flashcards.card.wrongAnswer', { answer: prompt.answer })}
		{:else if outcome === 'gaveUp'}
			{t('flashcards.card.gaveUp', { answer: prompt.answer })}
		{:else}
			&nbsp;
		{/if}
	</p>
{/if}

<p class="translation">{sentence.translation}</p>
{#if done && sentence.pinyin}
	<p class="reading" lang={language}>{sentence.pinyin}</p>
{/if}

<style>
	.sentence {
		margin: 0;
		font-size: 1.6rem;
	}

	.gap {
		position: relative;
		display: inline-block;
		min-width: 2rem;
		margin: 0 0.15rem;
		border-bottom: 2px solid color-mix(in srgb, currentColor 50%, transparent);
		text-align: center;
	}

	.gap.right {
		border-color: var(--good);
	}

	.gap.wrong {
		color: var(--readable-bad);
		border-color: var(--bad);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	.entry {
		margin-top: 1.25rem;
		display: grid;
		gap: 0.3rem;
		max-width: 22rem;
	}

	.entry label {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.entry input {
		min-height: 44px;
		padding: 0.4rem 0.7rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 1.4rem;
	}

	.actions {
		margin-top: 0.75rem;
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.primary,
	.secondary {
		min-height: 44px;
		padding: 0.4rem 1rem;
		border-radius: 0.4rem;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.primary {
		border: 0;
		background: var(--accent);
		color: var(--on-accent);
	}

	.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
	}

	.entry input:focus-visible,
	.primary:focus-visible,
	.secondary:focus-visible {
		outline: 2px solid var(--focus-colour);
		outline-offset: 2px;
	}

	.feedback {
		min-height: 1.4rem;
		margin: 0.75rem 0 0;
		font-weight: 600;
		color: var(--text);
	}

	.feedback.bad {
		color: var(--readable-bad);
	}

	.translation {
		margin: 1rem 0 0;
		font-size: 1.05rem;
		color: var(--readable-muted);
	}

	.reading {
		margin: 0.35rem 0 0;
		color: var(--readable-muted);
	}
</style>
