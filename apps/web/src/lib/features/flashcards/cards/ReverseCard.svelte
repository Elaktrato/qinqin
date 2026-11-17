<script lang="ts">
	import ReadingText from '$lib/components/ReadingText.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import { t } from '$lib/i18n';
	import { onMount } from 'svelte';
	import type { Entry } from '$lib/api/types';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import { creditLine } from '$lib/audio/button';
	import type { CardAudio } from '$lib/study/audioCue';
	import type { CardResult, FlowItem } from '$lib/study/cardFlow';
	import { buildVocabFaces } from '$lib/study/cardView';
	import {
		acceptedReverseAnswers,
		buildReverseFront,
		suggestReverseGrade
	} from '$lib/study/reverse';
	import type { ReviewMeta } from '$lib/study/types';

	interface Props {
		item: FlowItem;
		entry: Entry;
		/** The runner owns the reveal so Space/Enter can trigger it too. */
		revealed: boolean;
		/** The workspace language: the typed word is target-language text. */
		language: string;
		onDone: (result: CardResult) => void;
		audio?: CardAudio;
	}

	let { entry, revealed, language, onDone, audio }: Props = $props();

	const front = $derived(buildReverseFront(entry));
	const faces = $derived(buildVocabFaces(entry, null, language).back);
	const accepted = $derived(acceptedReverseAnswers(entry));
	const credit = $derived(audio ? creditLine(audio.clips) : '');

	let typed = $state('');
	let readingShown = $state(false);
	let field = $state<HTMLInputElement | null>(null);

	const typedGrade = $derived(suggestReverseGrade({ typed, accepted, readingShown: false }));
	const verdict = $derived(typedGrade === null ? null : typedGrade === 1 ? 'wrong' : 'right');

	onMount(() => field?.focus());

	/** Finishes the card with what was typed; the runner's Space/Enter calls it too. */
	export function finish(): void {
		if (revealed) return;
		const suggested = suggestReverseGrade({ typed, accepted, readingShown });
		const meta: ReviewMeta = {};
		if (readingShown) meta.hints = 1;
		if (suggested === 1) meta.mistakes = 1;
		onDone({ suggested, meta });
	}

	function onFieldKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		// An IME confirming a candidate also sends Enter (keyCode 229).
		if (event.isComposing || event.keyCode === 229) return;
		event.preventDefault();
		if (typed.trim() === '') return;
		finish();
	}
</script>

<section class="front" aria-label={t('flashcards.card.meaning')}>
	{#if front.pos.length > 0}
		<p class="pos">{front.pos.join(', ')}</p>
	{/if}
	{#if front.glosses.length > 0}
		<ol class="glosses">
			{#each front.glosses as gloss, i (i)}
				<li>{gloss}</li>
			{/each}
		</ol>
	{:else}
		<p class="hint">{t('flashcards.card.noGlosses')}</p>
	{/if}

	{#if !revealed}
		{#if readingShown && faces.readings.length > 0}
			<ul class="readings" aria-label={t('flashcards.card.readings')}>
				{#each faces.readings as reading, i (`${reading.type}:${i}`)}
					<li data-type={reading.type}><ReadingText type={reading.type} value={reading.value} language={entry.language} /></li>
				{/each}
			</ul>
		{:else if faces.readings.length > 0}
			<button type="button" class="secondary" onclick={() => (readingShown = true)}
				>{t('flashcards.card.showReading')}</button
			>
		{/if}
	{/if}
</section>

<div class="entry">
	<label for="reverse-answer">{t('flashcards.card.typeWord')}</label>
	<input
		id="reverse-answer"
		type="text"
		autocomplete="off"
		autocapitalize="off"
		spellcheck="false"
		lang={language}
		bind:this={field}
		bind:value={typed}
		disabled={revealed}
		onkeydown={onFieldKeydown}
	/>
</div>

{#if revealed}
	<section class="answer" aria-labelledby="reverse-answer-heading">
		<h2 id="reverse-answer-heading">{t('flashcards.card.answer')}</h2>
		{#if verdict !== null}
			<p class="feedback" class:bad={verdict === 'wrong'} role="status" aria-live="polite">
				{verdict === 'right' ? t('flashcards.card.correct') : t('flashcards.card.notQuite')}
			</p>
		{/if}
		<p class="written" lang={studyLang(language)}>{faces.written}</p>
		{#if faces.readings.length > 0}
			<ul class="readings" aria-label={t('flashcards.card.readings')}>
				{#each faces.readings as reading, i (`${reading.type}:${i}`)}
					<li data-type={reading.type}><ReadingText type={reading.type} value={reading.value} language={entry.language} /></li>
				{/each}
			</ul>
		{/if}
		{#if audio}
			<div class="sound">
				<PlayButton
					clips={audio.clips}
					speakText={audio.speakText}
					lang={audio.lang}
					deviceVoice={audio.deviceVoice}
					label={entry.written}
				/>
				{#if credit}
					<p class="credit">{credit}</p>
				{/if}
			</div>
		{/if}
		{#each faces.glosses as group (group.dictionaryName)}
			<article class="dictionary">
				<h3>{group.dictionaryName}</h3>
				<ol class="glosses">
					{#each group.glosses as gloss, i (i)}
						<li>{gloss}</li>
					{/each}
				</ol>
			</article>
		{/each}
	</section>
{:else}
	<button type="button" class="reveal" onclick={finish}>{t('flashcards.card.showAnswer')}</button>
{/if}

<style>
	.pos {
		margin: 0;
		font-size: 0.85rem;
		opacity: 0.7;
		font-style: italic;
	}

	.glosses {
		margin: 0.35rem 0 0;
		padding-left: 1.4rem;
		display: grid;
		gap: 0.25rem;
		font-size: 1.35rem;
	}

	.hint {
		opacity: 0.75;
	}

	.readings {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		opacity: 0.85;
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

	.entry input:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.secondary {
		margin-top: 0.75rem;
		min-height: 44px;
		padding: 0.4rem 0.9rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.reveal {
		margin-top: 1.25rem;
		min-height: 44px;
		padding: 0.55rem 1rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.secondary:focus-visible,
	.reveal:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.answer {
		margin-top: 1.5rem;
		border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		padding-top: 1rem;
	}

	.answer h2 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.written {
		margin: 0;
		font-size: 2.5rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.feedback {
		margin: 0 0 0.5rem;
		font-weight: 600;
		color: #2e7d32;
	}

	.feedback.bad {
		color: #c62828;
	}

	.sound {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin: 0.5rem 0;
	}

	.credit {
		margin: 0;
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.dictionary + .dictionary {
		margin-top: 0.9rem;
	}

	.dictionary h3 {
		margin: 0.5rem 0 0;
		font-size: 1rem;
	}
</style>
