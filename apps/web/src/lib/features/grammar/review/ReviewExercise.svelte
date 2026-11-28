<script lang="ts">
	// One exercise of a grammar review (#181): fill the gap with the lesson's authored distractors, or put the
	// sentence's words in order; then the sentence (its reading through the romanisation switches) and Next.
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import { segmentBatch } from '$lib/api/segment';
	import { loadTokens } from '$lib/exercises/wordSalad';
	import WordSaladBoard from '$lib/features/flashcards/cards/WordSaladBoard.svelte';
	import ClozeChoice from '../ClozeChoice.svelte';
	import { clozeParts, firstTry, type Exercise } from '../exercises';
	import { Button } from '$lib/ui';
	import { useRomanisation } from '$lib/languages/useRomanisation';

	interface Props {
		exercise: Exercise;
		/** The pack's language (segmentation, readings). */
		language: string;
		/** The lang attribute of the target-language text. */
		textLang: string;
		/** Fixes the word-order tiles' shuffle. */
		seed: string;
		/** The last exercise of the round: Next says Finish. */
		last: boolean;
		/** Next was pressed: right on the first try or not. */
		onNext: (right: boolean) => void;
	}

	let { exercise, language, textLang, seed, last, onNext }: Props = $props();

	const roman = useRomanisation();
	let result = $state<boolean | null>(null);
	let tokens = $state<string[] | null>(null);
	let nextButton = $state<HTMLElement | undefined>(undefined);
	let instruction = $state<HTMLElement | null>(null);

	const parts = $derived(exercise.kind === 'cloze' ? clozeParts(exercise.example.text, exercise.example.focus) : null);

	$effect(() => {
		const ex = exercise;
		tokens = null;
		if (ex.kind !== 'order') return;
		let cancelled = false;
		void loadTokens(language, ex.example.text, (l, s) => segmentBatch(l, s)).then((list) => {
			if (!cancelled) tokens = list;
		});
		return () => {
			cancelled = true;
		};
	});

	// A new exercise is a new step: the screen reader and the keyboard start at its instruction.
	$effect(() => {
		void exercise;
		void tick().then(() => instruction?.focus());
	});

	async function answer(right: boolean): Promise<void> {
		result = right;
		await tick();
		nextButton?.focus();
	}
</script>

{#if exercise.kind === 'cloze' && parts}
	<p class="instruction" tabindex="-1" bind:this={instruction}>{t('grammar.practice.cloze')}</p>
	<p class="translation">{exercise.example.translation}</p>
	<ClozeChoice
		before={parts.before}
		after={parts.after}
		choices={exercise.choices}
		answer={exercise.example.focus}
		language={textLang}
		onResult={(r) => void answer(r.correct)}
	/>
{:else if exercise.kind === 'order'}
	<p class="instruction" tabindex="-1" bind:this={instruction}>{t('grammar.practice.order')}</p>
	<p class="translation">{exercise.example.translation}</p>
	{#if tokens === null}
		<p role="status">{t('grammar.practice.preparing')}</p>
	{:else}
		<WordSaladBoard solution={tokens} {seed} disabled={result !== null} language={textLang} onResult={(r) => void answer(firstTry(r))} />
	{/if}
{/if}

{#if result !== null}
	<section class="reveal" aria-label={t('grammar.practice.sentence')}>
		<p class="sentence" lang={textLang}>{exercise.example.text}</p>
		{#if roman.text(exercise.example.reading, language)}<p class="reading">{exercise.example.reading}</p>{/if}
	</section>
	<Button variant="primary" bind:element={nextButton} onclick={() => onNext(result === true)}>
		{last ? t('grammar.practice.finish') : t('grammar.practice.next')}
	</Button>
{/if}

<style>
	.instruction:focus {
		outline: none;
	}

	.instruction {
		margin-block: var(--space-4) var(--space-1);
		font-weight: var(--weight-medium);
	}

	.translation {
		margin-block: 0 var(--space-3);
		font-size: var(--font-size-l);
		overflow-wrap: anywhere;
	}

	.reveal {
		margin-block: var(--space-2) var(--space-4);
	}

	.reveal p {
		margin: 0;
	}

	.sentence {
		font-size: var(--font-size-xl);
		overflow-wrap: anywhere;
	}

	.reading {
		color: var(--readable-muted);
		overflow-wrap: anywhere;
	}
</style>
