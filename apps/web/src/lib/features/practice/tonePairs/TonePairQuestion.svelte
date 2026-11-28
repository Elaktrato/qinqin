<script lang="ts">
	// One tone-pair question (#180): the word's two characters and its sound, a field for the two tones (typed through
	// the keyboard; the phone opens its digit pad) and a row of tone buttons per syllable as the fallback, then the
	// verdict per syllable with the citation tone, and the spoken tone where tone sandhi changes it and "Show tone
	// sandhi" is on. The component is not remounted between items: the field keeps the focus (the phone keyboard stays
	// up), is read-only once answered and empty for the next word. Pinyin letters only while pinyin shows (#284).
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { studyLang } from '$lib/i18n/lang';
	import { getEntryAudio } from '$lib/api/audio';
	import { headwordClips } from '$lib/audio/button';
	import { readAudioSettings } from '$lib/audio/settings';
	import type { AudioClip } from '$lib/api/audio';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import ToneContour from '$lib/components/ToneContour.svelte';
	import { useSession } from '$lib/context/context';
	import { readToneSettings } from '$lib/exercises/toneSettings';
	import { markedSyllable, TONE_GLYPHS, type Tone } from '$lib/exercises/tones';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import { Button } from '$lib/ui';
	import type { DrillQuestionProps } from '../types';
	import { checkPair, PAIR_MODE, slotsOf, textOf, type PairCheck } from './answer';
	import type { PairItemData } from './words';

	let { item, answered, onAnswer, onNext }: DrillQuestionProps = $props();

	const session = useSession();
	const roman = useRomanisation();
	const showPinyin = $derived(roman.shows('pinyin'));
	const settings = $derived(session.workspaces.current?.settings);
	const toneSettings = $derived(readToneSettings(settings));
	const deviceVoice = $derived(readAudioSettings(settings).deviceVoice);

	const data = $derived(item.data as PairItemData);
	const word = $derived(data.words[data.next] ?? data.words[0]);
	const chars = $derived([...word.written]);
	const textLang = $derived(studyLang(session.workspaces.current?.language ?? word.language));

	const TONES: { tone: Tone; name: string }[] = [
		{ tone: 1, name: t('flashcards.tone.name1') },
		{ tone: 2, name: t('flashcards.tone.name2') },
		{ tone: 3, name: t('flashcards.tone.name3') },
		{ tone: 4, name: t('flashcards.tone.name4') },
		{ tone: 5, name: t('flashcards.tone.name5') }
	];
	const nameOf = (tone: Tone): string => TONES[tone - 1].name;

	let text = $state('');
	let result = $state<PairCheck | null>(null);
	let problem = $state('');
	let clips = $state.raw<AudioClip[]>([]);
	let field = $state<HTMLInputElement | undefined>();

	const slots = $derived(slotsOf(text));

	// A new word: the component is not remounted, so it forgets the last answer itself, fetches the word's sound and
	// gives the field the focus when nothing has it (Next was tapped), so a phone keeps its keyboard for typing.
	$effect(() => {
		const id = word.entryId;
		text = '';
		result = null;
		problem = '';
		clips = [];
		void getEntryAudio(session.caches.audio, id).then(
			(res) => {
				if (word.entryId === id) clips = headwordClips(res);
			},
			() => {}
		);
		void tick().then(() => {
			const active = document.activeElement;
			if (active === null || active === document.body) field?.focus();
		});
	});

	function check(): void {
		if (answered || result !== null) return;
		const checked = checkPair(text, word, toneSettings.gradeSpoken);
		if (checked === null) {
			problem = t('practice.tonePairs.notTwo');
			return;
		}
		problem = '';
		result = checked;
		onAnswer({ mode: PAIR_MODE, grade: checked.grade });
	}

	function choose(index: number, tone: Tone): void {
		if (answered || result !== null) return;
		const next = [...slots];
		next[index] = tone;
		text = textOf(next);
		problem = '';
	}

	// A tap on Check or a tone button leaves the focus in the field, so a phone keeps its keyboard up.
	function keepFieldFocus(event: PointerEvent): void {
		if (document.activeElement === field) event.preventDefault();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		if (result === null) check();
		else onNext();
	}

	/** The reading of syllable `i` the verdict went by, and its spoken tone. */
	function answerOf(i: number): { plain: string; text: string; citation: Tone; spoken: Tone } | null {
		const best = result?.verdict.best?.[i];
		if (result === null || best === undefined) return null;
		return { plain: best.plain, text: best.text, citation: best.tone, spoken: result.verdict.spoken?.[i] ?? best.tone };
	}

	const pairText = (tones: readonly Tone[]): string => tones.join('-');
	// The tones that were wanted: the citation tones, or the spoken ones while spoken tones are graded.
	const expected = $derived(
		result === null ? '' : pairText(toneSettings.gradeSpoken ? (result.verdict.spoken ?? []) : (result.verdict.best ?? []).map((s) => s.tone))
	);
</script>

<div class="word">
	<p class="written" lang={textLang}>{word.written}</p>
	<PlayButton {clips} speakText={word.written} lang={word.language} {deviceVoice} label={word.written} />
</div>
<p class="ask">{t('practice.tonePairs.ask')}</p>
<p class="grading">{toneSettings.gradeSpoken ? t('practice.tonePairs.gradesSpoken') : t('practice.tonePairs.gradesCitation')}</p>

<div class="entry">
	<label for="tone-pair-answer">{t('practice.tonePairs.field')}</label>
	<div class="field-row">
		<input
			id="tone-pair-answer"
			bind:this={field}
			bind:value={text}
			oninput={() => (problem = '')}
			onkeydown={onKeydown}
			readonly={answered || result !== null}
			type="text"
			inputmode="numeric"
			enterkeyhint={result === null ? 'done' : 'next'}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			placeholder={t('practice.tonePairs.placeholder')}
			aria-describedby="tone-pair-problem"
			aria-invalid={problem !== ''}
		/>
		{#if result === null && !answered}
			<Button variant="primary" onpointerdown={keepFieldFocus} onclick={check}>{t('practice.tonePairs.check')}</Button>
		{/if}
	</div>
	<p id="tone-pair-problem" class="problem">{#if problem}<span role="alert">{problem}</span>{/if}</p>
</div>

<ol class="syllables" aria-label={t('practice.tonePairs.syllables')}>
	{#each chars as char, index (index)}
		{@const chosen = slots[index]}
		{@const mark = result?.verdict.marks[index]}
		{@const shown = answerOf(index)}
		<li class="syllable" class:right={mark === true} class:wrong={mark === false}>
			<span class="char" lang={textLang}>{char}</span>
			<span class="chosen" aria-hidden="true">
				{#if chosen !== null}{chosen}{TONE_GLYPHS[chosen]}<ToneContour tone={chosen} />{:else}–{/if}
			</span>
			<div class="tone-buttons" role="group" aria-label={t('practice.tonePairs.toneFor', { n: index + 1 })}>
				{#each TONES as option (option.tone)}
					<button
						type="button"
						class:selected={chosen === option.tone}
						aria-pressed={chosen === option.tone}
						aria-label={t('flashcards.tone.button', { tone: option.tone, name: option.name })}
						disabled={answered || result !== null}
						onpointerdown={keepFieldFocus}
						onclick={() => choose(index, option.tone)}
					>
						<span aria-hidden="true">{option.tone}{TONE_GLYPHS[option.tone]}</span>
					</button>
				{/each}
			</div>
			{#if shown !== null}
				{@const sandhi = toneSettings.showSandhi && shown.spoken !== shown.citation}
				<p class="answer" data-answer-tone={shown.citation} data-spoken-tone={shown.spoken}>
					{#if showPinyin}
						<span>{shown.text}</span>
						{#if sandhi}
							<span class="spoken"
								><span aria-hidden="true">→ {markedSyllable(shown.plain, shown.spoken)}</span><span class="sr-only"
									>{t('flashcards.tone.spokenAs', { tone: markedSyllable(shown.plain, shown.spoken) })}</span
								></span
							>
						{/if}
					{:else}
						<span class="tone"
							><span aria-hidden="true">{shown.citation}{TONE_GLYPHS[shown.citation]}</span><ToneContour tone={shown.citation} /><span
								class="sr-only">{nameOf(shown.citation)}</span
							></span
						>
						{#if sandhi}
							<span class="tone spoken"
								><span aria-hidden="true">→ {shown.spoken}{TONE_GLYPHS[shown.spoken]}</span><ToneContour tone={shown.spoken} /><span
									class="sr-only">{t('flashcards.tone.spokenAs', { tone: nameOf(shown.spoken) })}</span
								></span
							>
						{/if}
					{/if}
				</p>
			{/if}
		</li>
	{/each}
</ol>

<p class="feedback" class:bad={result !== null && !result.verdict.correct} role="status" aria-live="polite">
	{#if result !== null}
		{result.verdict.correct
			? t('practice.tonePairs.right', { pair: pairText(result.tones) })
			: t('practice.tonePairs.wrong', { answer: expected })}
	{/if}
</p>

<style>
	.word {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.written {
		margin: 0;
		font-family: var(--font-hanzi);
		font-size: 2.5rem;
		line-height: 1.1;
	}
	.ask,
	.grading {
		margin: 0;
	}
	.grading {
		color: var(--readable-muted);
	}
	.entry {
		display: grid;
		gap: var(--space-1);
	}
	.field-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.field-row input {
		flex: 1 1 8rem;
		min-width: 0;
		font-size: var(--font-size-l);
	}
	.problem {
		min-height: 1.2rem;
		margin: 0;
		color: var(--readable-bad);
	}
	.syllables {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.syllable {
		display: grid;
		justify-items: center;
		gap: var(--space-1);
		min-width: 0;
		padding: var(--space-2);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
	}
	.syllable.right {
		border-color: var(--good);
	}
	.syllable.wrong {
		border-color: var(--bad);
	}
	.char {
		font-family: var(--font-hanzi);
		font-size: 1.875rem;
		line-height: 1;
	}
	.chosen {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 1.5rem;
		color: var(--reading-accent);
		font-weight: var(--weight-medium);
	}
	.tone-buttons {
		display: flex;
		gap: 0.125rem;
	}
	.tone-buttons button {
		min-width: 1.5rem;
		min-height: 1.75rem;
		padding: 0 0.125rem;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--readable-muted);
		font: inherit;
		font-size: var(--font-size-s);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}
	.tone-buttons button.selected {
		color: var(--reading-accent);
		box-shadow: inset 0 -1.5px 0 var(--accent);
	}
	.tone-buttons button:disabled {
		cursor: default;
	}
	.tone-buttons button:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.answer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		margin: 0;
		font-weight: var(--weight-strong);
	}
	.wrong .answer {
		color: var(--readable-bad);
	}
	.tone {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.spoken {
		font-weight: var(--weight-regular);
	}
	.feedback {
		min-height: 1.4rem;
		margin: 0;
		font-weight: var(--weight-strong);
	}
	.feedback.bad {
		color: var(--readable-bad);
	}
	@media (pointer: coarse) {
		.tone-buttons button {
			min-width: 1.75rem;
			min-height: var(--hit);
		}
	}
	@media (forced-colors: active) {
		.syllable.right,
		.syllable.wrong {
			border: 2px solid Highlight;
		}
		.tone-buttons button.selected {
			text-decoration: underline;
		}
	}
</style>
