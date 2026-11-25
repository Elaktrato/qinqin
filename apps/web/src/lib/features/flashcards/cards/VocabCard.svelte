<script lang="ts">
	import ReadingTable from '$lib/features/flashcards/cards/ReadingTable.svelte';
	import AiTag from '$lib/components/AiTag.svelte';
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
	import FaceWork from '../face/FaceWork.svelte';
	import HintControl from '../face/HintControl.svelte';
	import HintShown from '../face/HintShown.svelte';
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
	const shownSentence = $derived(
		item.virtual
			? (entry.sentences[0] ?? null)
			: item.card?.sentenceId === undefined
				? null
				: (entry.sentences.find((candidate) => candidate.id === item.card?.sentenceId) ?? null)
	);
	const faces = $derived(buildVocabFaces(entry, shownSentence, entry.language));

	// The prompt is the word alone; its readings and example sentence belong
	// to the answer, below the hairline (design §9, #101).
	const hasReadings = $derived(faces.back.readings.length > 0);

	const credit = $derived(audio ? creditLine(audio.clips) : '');

	function reveal(): void {
		onDone({ suggested: null, meta: {} });
	}

	// The docked primary (#101): Show answer until the reveal.
	usePrimary(() => (revealed ? null : { label: t('flashcards.card.showAnswer'), run: reveal }));
</script>

<FacePrompt>
	<HintShown {entry} />
	<p class="fp-word" lang={studyLang(entry.language)}>{faces.front.written}</p>
</FacePrompt>

<FaceWork>
	<HintControl />
</FaceWork>

{#if revealed}
	<FaceAnswer>
		{#if hasReadings || audio}
			<div class="fa-readings">
				{#if hasReadings}
					<ReadingTable readings={faces.back.readings} language={entry.language} label={t('flashcards.card.readings')} />
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
		{#each faces.back.sentenceLines as line, lineIndex (lineIndex)}
			<p class="sentence">{line}</p>
		{/each}
		{#if faces.back.sentenceLines.length > 0}<AiTag ai={shownSentence?.ai} />{/if}
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
		{:else if entry.kind !== 'character'}
			<p class="hint">{t('flashcards.card.noGlosses')}</p>
		{/if}
		{#if credit}
			<p class="credit fa-source">{credit}</p>
		{/if}
	</FaceAnswer>
{/if}

<style>
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
