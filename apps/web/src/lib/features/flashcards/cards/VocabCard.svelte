<script lang="ts">
	import ReadingTable from '$lib/features/flashcards/cards/ReadingTable.svelte';
	import AiTag from '$lib/components/AiTag.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import { t } from '$lib/i18n';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import type { Entry } from '$lib/api/types';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import { creditLine } from '$lib/audio/button';
	import type { CardAudio } from '$lib/audio/cue';
	import type { CardResult, FlowItem } from '../session/cardFlow';
	import type { StarterFront } from '$lib/starter/starter';
	import { buildVocabFaces } from './cardView';
	import CardGlosses from './CardGlosses.svelte';
	import AnswerAids from '../face/AnswerAids.svelte';
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
		/**
		 * Starter mode (#214): what the front shows at this word's stage, and the "New" note for the
		 * first time at a stage. Without it (or with a null front) the card is the normal card.
		 */
		starter?: { front: StarterFront | null; note: string | null } | null;
	}

	let { item, entry, revealed, onDone, audio, starter = null }: Props = $props();
	const front = $derived(starter?.front ?? null);
	// Hidden romanisation (#284): the answer's reading table drops a hidden type (ReadingTable).
	const roman = useRomanisation();

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
	// A card pinned to a reading (#346, a Starter word's) shows only that reading's meanings.
	const faces = $derived(buildVocabFaces(entry, shownSentence, entry.language, item.card?.reading));

	// The prompt is the word alone; its readings and example sentence belong
	// to the answer, below the hairline (design §9, #101).
	const hasReadings = $derived(roman.shown(faces.back.readings).length > 0);

	const credit = $derived(audio ? creditLine(audio.clips) : '');

	function reveal(): void {
		onDone({ suggested: null, meta: {} });
	}

	// The docked primary (#101): Show answer until the reveal.
	usePrimary(() => (revealed ? null : { label: t('flashcards.card.showAnswer'), run: reveal }));
</script>

<FacePrompt>
	{#if starter?.note}
		<p class="starter-note" role="status" data-testid="starter-note">{starter.note}</p>
	{/if}
	<HintShown {entry} />
	{#if front !== null}
		<!-- Starter mode: the word as far as the learner has come (#214). The annotation is ruby when it sits above the
		word (furigana, pinyin), so a screen reader and a browser without ruby both get it. -->
		<p class="fp-word starter-front" data-testid="starter-front" data-placement={front.placement ?? 'none'}>
			{#if front.annotation !== null && front.placement === 'above'}
				<ruby
					><span lang={front.mainLang}>{front.main}</span><rp>(</rp><rt lang={front.annotationLang ?? undefined}>{front.annotation}</rt
					><rp>)</rp></ruby
				>
			{:else}
				<span lang={front.mainLang}>{front.main}</span>
			{/if}
		</p>
		{#if front.annotation !== null && front.placement === 'below'}
			<p class="starter-below" lang={front.annotationLang ?? undefined}>{front.annotation}</p>
		{/if}
		{#if audio && !revealed}
			<span class="fa-play" data-testid="starter-play">
				<PlayButton
					clips={audio.clips}
					speakText={audio.speakText}
					lang={audio.lang}
					deviceVoice={audio.deviceVoice}
					label={entry.written}
				/>
			</span>
		{/if}
	{:else}
		<p class="fp-word" lang={studyLang(entry.language)}>{faces.front.written}</p>
	{/if}
</FacePrompt>

<FaceWork>
	<HintControl />
</FaceWork>

{#if revealed}
	<FaceAnswer>
		<AnswerAids {entry} />
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
			{#key entry.id}<CardGlosses glosses={faces.back.glosses} folded={faces.back.folded} />{/key}
		{:else if entry.kind !== 'character'}
			<p class="hint">{t('flashcards.card.noGlosses')}</p>
		{/if}
		{#if credit}
			<p class="credit fa-source">{credit}</p>
		{/if}
	</FaceAnswer>
{/if}

<style>
	.starter-note {
		margin: 0;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--accent-32);
		border-radius: var(--radius);
		background: var(--accent-14);
		font-size: var(--font-size-s);
	}
	.starter-front ruby {
		ruby-position: over;
	}
	.starter-front rt {
		color: var(--reading-accent);
		font-size: 0.45em;
	}
	.starter-below {
		margin: 0;
		color: var(--reading-accent);
		font-size: var(--font-size-l);
	}
	.sentence {
		font-family: var(--font-hanzi);
		font-size: var(--font-size-l);
	}
	.hint {
		color: var(--readable-muted);
	}
</style>
