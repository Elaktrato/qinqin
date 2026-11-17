<script lang="ts">
	import ReadingText from '$lib/components/ReadingText.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import { t } from '$lib/i18n';
	import type { Entry } from '$lib/api/types';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import { creditLine } from '$lib/audio/button';
	import type { CardAudio } from '$lib/study/audioCue';
	import type { CardResult, FlowItem } from '$lib/study/cardFlow';
	import { buildVocabFaces } from '$lib/study/cardView';

	interface Props {
		item: FlowItem;
		entry: Entry;
		/** The runner owns the reveal so Space/Enter can trigger it too. */
		revealed: boolean;
		onDone: (result: CardResult) => void;
		/** Pronunciation; its button shows only after the reveal. */
		audio?: CardAudio;
	}

	let { item, entry, revealed, onDone, audio }: Props = $props();

	// A sentence id that no longer resolves is passed as null so the card
	// simply has no sentence block. A virtual level card previews the
	// sentence it will be created with.
	const faces = $derived.by(() => {
		const sentence = item.virtual
			? (entry.sentences[0] ?? null)
			: item.card?.sentenceId === undefined
				? null
				: (entry.sentences.find((candidate) => candidate.id === item.card?.sentenceId) ?? null);
		return buildVocabFaces(entry, sentence, entry.language);
	});

	// A character shows its readings only after the reveal; a word has them on
	// the front already.
	const showsBackReadings = $derived(
		faces.front.readings.length === 0 && faces.back.readings.length > 0
	);

	const credit = $derived(audio ? creditLine(audio.clips) : '');

	function reveal(): void {
		onDone({ suggested: null, meta: {} });
	}
</script>

<p class="written" lang={studyLang(entry.language)}>{faces.front.written}</p>

{#if faces.front.readings.length > 0}
	<ul class="readings" aria-label={t('flashcards.card.readings')}>
		{#each faces.front.readings as reading, readingIndex (`${reading.type}:${readingIndex}`)}
			<li data-type={reading.type}><ReadingText type={reading.type} value={reading.value} language={entry.language} /></li>
		{/each}
	</ul>
{/if}

{#if faces.front.sentenceLines.length > 0}
	<div class="sentences">
		{#each faces.front.sentenceLines as line, lineIndex (lineIndex)}
			<p class="sentence">{line}</p>
		{/each}
	</div>
{/if}

{#if revealed}
	<section class="answer" aria-labelledby="answer-heading">
		<h2 id="answer-heading">{t('flashcards.card.answer')}</h2>
		{#if showsBackReadings}
			<ul class="readings back-readings" aria-label={t('flashcards.card.readings')}>
				{#each faces.back.readings as reading, readingIndex (`${reading.type}:${readingIndex}`)}
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
		{#if faces.back.glosses.length > 0}
			{#each faces.back.glosses as group (group.dictionaryName)}
				<article class="dictionary">
					<h3>{group.dictionaryName}</h3>
					<ol class="glosses">
						{#each group.glosses as gloss, glossIndex (glossIndex)}
							<li>{gloss}</li>
						{/each}
					</ol>
				</article>
			{/each}
		{:else if !showsBackReadings}
			<p class="hint">{t('flashcards.card.noGlosses')}</p>
		{/if}
	</section>
{:else}
	<button type="button" class="reveal" onclick={reveal}>{t('flashcards.card.showAnswer')}</button>
{/if}

<style>
	.written {
		margin: 0;
		font-size: 2.75rem;
		font-weight: 700;
		line-height: 1.2;
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

	.back-readings {
		margin: 0 0 0.75rem;
		font-size: 1.15rem;
	}

	.sentences {
		margin-top: 1.25rem;
		display: grid;
		gap: 0.35rem;
	}

	.sentence {
		margin: 0;
		font-size: 1.15rem;
	}

	.hint {
		opacity: 0.75;
	}

	.sound {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin: 0 0 0.75rem;
	}

	.credit {
		margin: 0;
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.reveal {
		margin-top: 1.5rem;
		padding: 0.55rem 1rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

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

	.dictionary + .dictionary {
		margin-top: 0.9rem;
	}

	.dictionary h3 {
		margin: 0;
		font-size: 1rem;
	}

	.glosses {
		margin: 0.35rem 0 0;
		padding-left: 1.4rem;
		display: grid;
		gap: 0.25rem;
	}
</style>
