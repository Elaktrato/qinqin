<script lang="ts">
	import { t } from '$lib/i18n';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import Msg from '$lib/ui/Msg.svelte';
	import { segmentBatch } from '$lib/api/segment';
	import type { Entry, Sentence } from '$lib/api/types';
	import WordSaladBoard from './WordSaladBoard.svelte';
	import AiTag from '$lib/components/AiTag.svelte';
	import SentenceCredit from '$lib/entry/SentenceCredit.svelte';
	import SentenceSource from '$lib/entry/SentenceSource.svelte';
	import FaceAnswer from '../face/FaceAnswer.svelte';
	import FacePrompt from '../face/FacePrompt.svelte';
	import HintControl from '../face/HintControl.svelte';
	import HintShown from '../face/HintShown.svelte';
	import FaceWork from '../face/FaceWork.svelte';
	import { usePrimary, type FacePrimary } from '../face/cardFace.svelte';
	import type { CardResult, FlowItem } from '../session/cardFlow';
	import {
		loadTokens,
		splitWithin,
		suggestSaladGrade,
		type SaladTier
	} from '$lib/exercises/wordSalad';

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
	const roman = useRomanisation();

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

	// The board's Check is the docked primary (#101), disabled until a tile is placed.
	let boardCheck = $state.raw<FacePrimary | null>(null);
	usePrimary(() => (done ? null : boardCheck));
</script>

<FacePrompt>
	{#if !hidesTranslation || translationShown || done}
		<p class="fp-meaning translation">{sentence.translation || t('flashcards.card.noTranslation')}</p>
	{:else}
		<button type="button" class="cloze" onclick={showTranslation}>
			<span aria-hidden="true" class="blur">{sentence.translation || '—'}</span>
			<span class="cloze-label">{t('flashcards.card.showTranslation')}</span>
		</button>
	{/if}
	<p class="fp-sub target">
		<Msg key="flashcards.card.uses" args={{ word: entry.written }}
			>{#snippet strong(text: string)}<strong lang={language}>{text}</strong>{/snippet}</Msg
		>
	</p>
	<HintShown {entry} />
	<AiTag ai={sentence.ai} />
</FacePrompt>

<FaceWork>
	<HintControl />
	{#if solution === null}
		<p class="hint" role="status">{t('flashcards.card.preparing')}</p>
	{:else}
		<WordSaladBoard
			{solution}
			{seed}
			disabled={done}
			onResult={finish}
			{language}
			dockCheck={(check) => (boardCheck = check)}
		/>
	{/if}
</FaceWork>

{#if done}
	<FaceAnswer>
		<section class="reveal" aria-label={t('flashcards.card.theSentence')}>
			<p class="sentence" lang={language}>{sentence.hanzi}</p>
			{#if roman.text(sentence.pinyin, entry.language)}
				<p class="fa-reading">{sentence.pinyin}</p>
			{/if}
			{#if sentence.translation}
				<p class="translation">{sentence.translation}</p>
			{/if}
			{#if sentence.credit}<SentenceCredit credit={sentence.credit} />{/if}
			{#if sentence.source}<SentenceSource source={sentence.source} linked={false} />{/if}
		</section>
	</FaceAnswer>
{/if}

<style>
	.cloze {
		position: relative;
		display: grid;
		justify-items: center;
		padding: var(--space-2) var(--space-3);
		border: 1px dashed var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.cloze:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.blur {
		filter: blur(6px);
		user-select: none;
	}

	.cloze-label {
		margin-top: var(--space-1);
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
		color: var(--reading-accent);
	}

	.hint {
		margin: 0;
		color: var(--readable-muted);
	}

	.reveal {
		display: grid;
		gap: var(--space-1);
	}

	.sentence {
		font-family: var(--font-hanzi);
		font-size: var(--font-size-xl);
		line-height: 1.6;
	}
</style>
