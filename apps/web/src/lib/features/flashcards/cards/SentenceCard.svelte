<script lang="ts">
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { segmentBatch } from '$lib/api/segment';
	import type { Entry, Sentence } from '$lib/api/types';
	import WordSaladBoard from './WordSaladBoard.svelte';
	import type { CardResult, FlowItem } from '$lib/study/cardFlow';
	import {
		loadTokens,
		splitWithin,
		suggestSaladGrade,
		type SaladTier
	} from '$lib/study/wordSalad';

	interface Props {
		item: FlowItem;
		entry: Entry;
		sentence: Sentence;
		tier: SaladTier;
		/** Shuffle seed: the card id plus its review count. */
		seed: string;
		language: string;
		done: boolean;
		onDone: (result: CardResult) => void;
	}

	let { item, entry, sentence, tier, seed, language, done, onDone }: Props = $props();

	// The order the learner must rebuild; the board owns tiles and checking.
	let solution = $state<string[] | null>(null);
	let translationShown = $state(false);

	const hidesTranslation = $derived(tier > 0);

	$effect(() => {
		const text = sentence.hanzi;
		const lang = language;
		const level = tier;
		let cancelled = false;
		void loadTokens(lang, text, (l, t) => segmentBatch(l, t)).then((tokens) => {
			if (cancelled) return;
			const order = level === 2 ? splitWithin(tokens) : tokens;
			solution = order;
		});
		return () => {
			cancelled = true;
		};
	});

	function hints(result: { gaveUp: boolean }): number {
		return (translationShown ? 1 : 0) + (result.gaveUp ? 1 : 0);
	}

	function finish(result: { wrongChecks: number; gaveUp: boolean }): void {
		onDone({
			suggested: suggestSaladGrade({ wrongChecks: result.wrongChecks, revealed: result.gaveUp }),
			meta: { tier, mistakes: result.wrongChecks, hints: hints(result) }
		});
	}

	function showTranslation(): void {
		translationShown = true;
	}
</script>

<div class="prompt">
	{#if !hidesTranslation || translationShown || done}
		<p class="translation">{sentence.translation || t('flashcards.card.noTranslation')}</p>
	{:else}
		<button type="button" class="cloze" onclick={showTranslation}>
			<span aria-hidden="true" class="blur">{sentence.translation || '—'}</span>
			<span class="cloze-label">{t('flashcards.card.showTranslation')}</span>
		</button>
	{/if}
	<p class="target">
		<Msg key="flashcards.card.uses" args={{ word: entry.written }}
			>{#snippet strong(text: string)}<strong lang={language}>{text}</strong>{/snippet}</Msg
		>
	</p>
</div>

{#if solution === null}
	<p class="hint" role="status">{t('flashcards.card.preparing')}</p>
{:else}
	<WordSaladBoard {solution} {seed} disabled={done} onResult={finish} language={language} />
{/if}

{#if done}
	<section class="reveal" aria-label={t('flashcards.card.theSentence')}>
		<p class="sentence" lang={language}>{sentence.hanzi}</p>
		{#if sentence.pinyin}
			<p class="pinyin">{sentence.pinyin}</p>
		{/if}
		{#if sentence.translation}
			<p class="translation">{sentence.translation}</p>
		{/if}
	</section>
{/if}

<style>
	.prompt {
		display: grid;
		gap: 0.5rem;
	}

	.translation {
		margin: 0;
		font-size: 1.15rem;
	}

	.target {
		margin: 0;
		opacity: 0.75;
	}

	.cloze {
		position: relative;
		display: grid;
		justify-items: start;
		padding: 0.5rem 0.75rem;
		border: 1px dashed color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.cloze:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.blur {
		filter: blur(6px);
		user-select: none;
	}

	.cloze-label {
		margin-top: 0.25rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #0b6bcb;
	}

	.hint {
		opacity: 0.75;
	}

	.reveal {
		margin-top: 1rem;
		border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		padding-top: 1rem;
		display: grid;
		gap: 0.35rem;
	}

	.reveal p {
		margin: 0;
	}

	.sentence {
		font-size: 1.35rem;
	}

	.pinyin {
		opacity: 0.8;
	}
</style>
