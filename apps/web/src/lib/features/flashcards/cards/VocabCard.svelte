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
	import FaceAnswer from '../face/FaceAnswer.svelte';
	import FacePrompt from '../face/FacePrompt.svelte';
	import { usePrimary } from '../face/cardFace.svelte';

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

	// The docked primary (#101): Show answer until the reveal.
	usePrimary(() => (revealed ? null : { label: t('flashcards.card.showAnswer'), run: reveal }));
</script>

<FacePrompt>
	<p class="fp-word" lang={studyLang(entry.language)}>{faces.front.written}</p>
	{#if faces.front.readings.length > 0}
		<ul class="readings fp-sub" aria-label={t('flashcards.card.readings')}>
			{#each faces.front.readings as reading, readingIndex (`${reading.type}:${readingIndex}`)}
				<li data-type={reading.type}><ReadingText type={reading.type} value={reading.value} language={entry.language} /></li>
			{/each}
		</ul>
	{/if}
	{#if faces.front.sentenceLines.length > 0}
		{#each faces.front.sentenceLines as line, lineIndex (lineIndex)}
			<p class="sentence">{line}</p>
		{/each}
	{/if}
</FacePrompt>

{#if revealed}
	<FaceAnswer>
		{#if showsBackReadings || audio}
			<div class="fa-readings">
				{#if showsBackReadings}
					<ul class="fa-readings back-readings" aria-label={t('flashcards.card.readings')}>
						{#each faces.back.readings as reading, readingIndex (`${reading.type}:${readingIndex}`)}
							<li class="fa-reading" data-type={reading.type}><ReadingText type={reading.type} value={reading.value} language={entry.language} /></li>
						{/each}
					</ul>
				{/if}
				{#if audio}
					<span class="fa-play">
						<PlayButton
							clips={audio.clips}
							speakText={audio.speakText}
							lang={audio.lang}
							deviceVoice={audio.deviceVoice}
							label={entry.written}
						/>
					</span>
				{/if}
			</div>
		{/if}
		{#if faces.back.glosses.length > 0}
			{#each faces.back.glosses as group (group.dictionaryName)}
				<article class="dictionary">
					<ol class="fa-glosses">
						{#each group.glosses as gloss, glossIndex (glossIndex)}
							<li>{gloss}</li>
						{/each}
					</ol>
					<p class="fa-source">{group.dictionaryName}</p>
				</article>
			{/each}
		{:else if !showsBackReadings}
			<p class="hint">{t('flashcards.card.noGlosses')}</p>
		{/if}
		{#if credit}
			<p class="credit fa-source">{credit}</p>
		{/if}
	</FaceAnswer>
{/if}

<style>
	.readings {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-1) var(--space-3);
		padding: 0;
		list-style: none;
	}
	.sentence {
		font-family: var(--font-hanzi);
		font-size: var(--font-size-l);
	}
	.hint {
		color: var(--readable-muted);
	}
	.dictionary {
		display: grid;
		gap: var(--space-1);
	}
</style>
