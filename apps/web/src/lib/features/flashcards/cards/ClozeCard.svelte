<script lang="ts">
	import { t } from '$lib/i18n';
	import { onMount } from 'svelte';
	import type { Entry, Sentence } from '$lib/api/types';
	import { choiceForKeyEvent } from '$lib/components/clozeKeys';
	import type { CardResult, FlowItem } from '$lib/study/cardFlow';
	import { normalizeAnswer, suggestClozeGrade, type ClozeMode, type ClozePrompt } from '$lib/study/cloze';
	import Button from '$lib/ui/Button.svelte';
	import Field from '$lib/ui/Field.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import FaceAnswer from '../face/FaceAnswer.svelte';
	import FacePrompt from '../face/FacePrompt.svelte';
	import FaceWork from '../face/FaceWork.svelte';
	import { usePrimary } from '../face/cardFace.svelte';

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
	let field = $state<HTMLInputElement | HTMLTextAreaElement>();
	let outcome = $state<'right' | 'wrong' | 'gaveUp' | null>(null);
	// Choose mode: the picked choice (picking is the answer).
	let picked = $state<string | null>(null);

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

	function pick(choice: string): void {
		if (outcome !== null || done) return;
		picked = choice;
		finish(choice === prompt.answer ? 'right' : 'wrong');
	}

	function onFieldKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		// An IME confirming a candidate also sends Enter (keyCode 229).
		if (event.isComposing || event.keyCode === 229) return;
		event.preventDefault();
		check();
	}

	// Choose mode: 1–4 pick a choice until the card is answered; then the
	// digits belong to the grade bar.
	function onWindowKeydown(event: KeyboardEvent): void {
		if (mode !== 'choose' || outcome !== null || done) return;
		const index = choiceForKeyEvent(
			{
				key: event.key,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				isComposing: event.isComposing,
				target: event.target instanceof HTMLElement ? event.target : null
			},
			choices.length
		);
		if (index === null) return;
		event.preventDefault();
		pick(choices[index]);
	}

	// The docked primary (#101): Check in type mode (disabled while empty);
	// in choose mode picking is the answer and the primary gives up.
	usePrimary(() => {
		if (done || outcome !== null) return null;
		if (mode === 'choose') return { label: t('flashcards.card.showAnswer'), run: () => finish('gaveUp') };
		return { label: t('flashcards.card.check'), run: check, disabled: typed.trim() === '' };
	});

	const finished = $derived(done || outcome !== null);
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet gap(surface: string | undefined)}
	<span class="gap" class:right={outcome === 'right'} class:wrong={outcome === 'wrong' || outcome === 'gaveUp'}
		><span class="sr-only">{t('flashcards.card.blank')}</span>{done ? (surface ?? prompt.answer) : '＿＿'}{#if done && outcome === 'right'}<Icon
				name="check"
				size="s"
			/>{/if}</span
	>
{/snippet}

<FacePrompt>
	<p class="fp-sentence sentence" lang={language}>
		{#each prompt.before as part, i (i)}{#if typeof part === 'string'}{part}{:else}{@render gap(part.answer)}{/if}{/each}{@render gap(undefined)}{#each prompt.after as part, i (i)}{#if typeof part === 'string'}{part}{:else}{@render gap(part.answer)}{/if}{/each}
	</p>
	<p class="fp-sub translation">{sentence.translation}</p>
</FacePrompt>

<FaceWork>
	{#if mode === 'choose'}
		<ul class="choices" aria-label={t('entry.cloze.choices')}>
			{#each choices as choice, i (choice)}
				<li>
					<button
						type="button"
						class="choice"
						class:right={finished && choice === prompt.answer}
						class:wrong={choice === picked && choice !== prompt.answer}
						disabled={finished}
						aria-keyshortcuts={String(i + 1)}
						lang={language}
						onclick={() => pick(choice)}
					>
						<kbd aria-hidden="true">{i + 1}</kbd>
						<span>{choice}</span>
						{#if finished && choice === prompt.answer}<Icon name="check" size="s" />{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="entry" class:right={outcome === 'right'}>
			<Field
				label={t('flashcards.card.typeWord')}
				id="cloze-answer"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				lang={language}
				bind:element={field}
				bind:value={typed}
				disabled={done}
				onkeydown={onFieldKeydown}
			/>
		</div>
		{#if !done && outcome === null}
			<Button variant="plain" onclick={() => finish('gaveUp')}>{t('flashcards.card.showAnswer')}</Button>
		{/if}
	{/if}
	<p class="feedback" class:bad={outcome === 'wrong' || outcome === 'gaveUp'} role="status" aria-live="polite">
		{#if outcome === 'right'}
			<Icon name="check" size="s" /><span>{t('flashcards.card.correct')}</span>
		{:else if outcome === 'wrong'}
			<Icon name="close" size="s" /><span>{t('flashcards.card.wrongAnswer', { answer: prompt.answer })}</span>
		{:else if outcome === 'gaveUp'}
			<Icon name="close" size="s" /><span>{t('flashcards.card.gaveUp', { answer: prompt.answer })}</span>
		{/if}
	</p>
</FaceWork>

{#if done && sentence.pinyin}
	<FaceAnswer>
		<p class="fa-reading reading" lang={language}>{sentence.pinyin}</p>
	</FaceAnswer>
{/if}

<style>
	.sentence {
		line-height: 1.6;
	}
	.gap {
		position: relative;
		display: inline-block;
		min-width: 2.4em;
		margin: 0 0.15rem;
		border-bottom: 2px solid var(--accent);
		color: var(--reading-accent);
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
		width: 100%;
		max-width: 20rem;
	}
	.entry :global(input) {
		font-family: var(--font-hanzi);
		font-size: 1.25rem;
		text-align: center;
	}
	.entry.right :global(input) {
		border-bottom: 2px solid var(--good);
	}
	.choices {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
		width: 100%;
		max-width: 22.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.choice {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		box-sizing: border-box;
		width: 100%;
		min-height: var(--hit);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-family: var(--font-hanzi);
		font-size: 1.2rem;
		font-weight: var(--weight-regular);
		cursor: pointer;
	}
	.choice:hover:not(:disabled) {
		border-color: var(--line);
	}
	.choice:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.choice:disabled {
		cursor: default;
	}
	.choice.right {
		border-color: var(--good);
		box-shadow: inset 0 0 0 0.5px var(--good);
	}
	.choice.wrong {
		border-color: var(--bad);
	}
	kbd {
		font-family: var(--font-ui);
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
	}
	.feedback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-height: 1.4rem;
		margin: 0;
		font-weight: var(--weight-strong);
		color: var(--text);
		text-align: center;
	}
	.feedback.bad {
		color: var(--readable-bad);
	}
	@media (forced-colors: active) {
		.choice {
			border-color: ButtonText;
		}
		.choice.right {
			border: 2px solid Highlight;
		}
	}
</style>
