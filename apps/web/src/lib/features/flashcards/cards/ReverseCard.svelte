<script lang="ts">
	import ReadingText from '$lib/components/ReadingText.svelte';
	import ReadingTable from '$lib/features/flashcards/cards/ReadingTable.svelte';
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
	let field = $state<HTMLInputElement | HTMLTextAreaElement>();

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

	// The docked primary (#101): Show answer while the field is empty, Check
	// once something is typed; both finish the card as before.
	usePrimary(() =>
		revealed
			? null
			: { label: typed.trim() === '' ? t('flashcards.card.showAnswer') : t('flashcards.card.check'), run: finish }
	);

	function onFieldKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		// An IME confirming a candidate also sends Enter (keyCode 229).
		if (event.isComposing || event.keyCode === 229) return;
		event.preventDefault();
		if (typed.trim() === '') return;
		finish();
	}
</script>

<FacePrompt>
	<section class="front" aria-label={t('flashcards.card.meaning')}>
		{#if front.pos.length > 0}
			<p class="fp-sub">{front.pos.join(', ')}</p>
		{/if}
		{#if front.glosses.length > 0}
			<ol class="glosses fp-meaning">
				{#each front.glosses as gloss, i (i)}
					<li>{gloss}</li>
				{/each}
			</ol>
		{:else}
			<p class="fp-sub">{t('flashcards.card.noGlosses')}</p>
		{/if}
	</section>
</FacePrompt>

<FaceWork>
	<div class="entry" class:right={revealed && verdict === 'right'}>
		<Field
			label={t('flashcards.card.typeWord')}
			id="reverse-answer"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			lang={language}
			bind:element={field}
			bind:value={typed}
			disabled={revealed}
			onkeydown={onFieldKeydown}
		/>
	</div>
	{#if !revealed && faces.readings.length > 0}
		{#if readingShown}
			<ul class="readings" aria-label={t('flashcards.card.readings')}>
				{#each faces.readings as reading, i (`${reading.type}:${i}`)}
					<li data-type={reading.type}><ReadingText type={reading.type} value={reading.value} language={entry.language} /></li>
				{/each}
			</ul>
		{:else}
			<Button variant="plain" onclick={() => (readingShown = true)}>{t('flashcards.card.showReading')}</Button>
		{/if}
	{/if}
</FaceWork>

{#if revealed}
	<FaceAnswer>
		{#if verdict !== null}
			<p class="feedback" class:bad={verdict === 'wrong'} role="status" aria-live="polite">
				<Icon name={verdict === 'right' ? 'check' : 'close'} size="s" />
				<span>{verdict === 'right' ? t('flashcards.card.correct') : t('flashcards.card.notQuite')}</span>
			</p>
		{/if}
		<p class="fa-word" lang={studyLang(language)}>{faces.written}</p>
		{#if faces.readings.length > 0 || audio}
			<div class="fa-readings">
				{#if faces.readings.length > 0}
					<ReadingTable readings={faces.readings} language={entry.language} label={t('flashcards.card.readings')} />
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
		{#each faces.glosses as group (group.dictionaryName)}
			<article class="dictionary">
				<ol class="fa-glosses">
					{#each group.glosses as gloss, i (i)}
						<li>{gloss}</li>
					{/each}
				</ol>
				<p class="fa-source">{group.dictionaryName}</p>
			</article>
		{/each}
		{#if credit}
			<p class="credit fa-source">{credit}</p>
		{/if}
	</FaceAnswer>
{/if}

<style>
	.front {
		display: grid;
		gap: var(--space-1);
		justify-items: center;
	}
	.glosses {
		display: grid;
		gap: var(--space-1);
		padding: 0;
		list-style: none;
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
	.readings {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--reading-accent);
	}
	.feedback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		font-weight: var(--weight-strong);
		color: var(--text);
	}
	.feedback.bad {
		color: var(--readable-bad);
	}
	.dictionary {
		display: grid;
		gap: var(--space-1);
	}
</style>
