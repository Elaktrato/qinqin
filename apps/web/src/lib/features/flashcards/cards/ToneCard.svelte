<script lang="ts">
	import { t } from '$lib/i18n';
	import { readingLang, studyLang } from '$lib/i18n/lang';
	import ReadingTable from '$lib/features/flashcards/cards/ReadingTable.svelte';
	import { onDestroy } from 'svelte';
	import type { Entry } from '$lib/api/types';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import { creditLine } from '$lib/audio/button';
	import type { CardAudio } from '$lib/audio/cue';
	import { type CardResult, type FlowItem } from '../session/cardFlow';
	import {
		markedSyllable,
		suggestToneGrade,
		toneFromGesture,
		type GesturePoint,
		type Tone,
		pinyinReadings,
		tonePadLabels,
		toneCandidates,
		toneVerdict,
		TONE_CONTOURS,
		type ToneVerdict
	} from '$lib/exercises/tones';
	import ToneContour from '$lib/components/ToneContour.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import FaceAnswer from '../face/FaceAnswer.svelte';
	import FacePrompt from '../face/FacePrompt.svelte';
	import HintControl from '../face/HintControl.svelte';
	import HintShown from '../face/HintShown.svelte';
	import FaceWork from '../face/FaceWork.svelte';
	import { usePrimary } from '../face/cardFace.svelte';
	import { useSession } from '$lib/context/context';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import { readToneSettings } from '$lib/exercises/toneSettings';
	const session = useSession();

	interface Props {
		item: FlowItem;
		entry: Entry;
		done: boolean;
		onDone: (result: CardResult) => void;
		/** Pronunciation; its button shows only once the card is done. */
		audio?: CardAudio;
	}

	let { item, entry, done, onDone, audio }: Props = $props();

	// The workspace's script (a zh-Hant workspace shows traditional forms), else the entry's language.
	const textLang = $derived(studyLang(session.workspaces.current?.language ?? entry.language));

	const TONES: { tone: Tone; glyph: string; name: string }[] = [
		{ tone: 1, glyph: 'ˉ', name: t('flashcards.tone.name1') },
		{ tone: 2, glyph: 'ˊ', name: t('flashcards.tone.name2') },
		{ tone: 3, glyph: 'ˇ', name: t('flashcards.tone.name3') },
		{ tone: 4, glyph: 'ˋ', name: t('flashcards.tone.name4') },
		{ tone: 5, glyph: '·', name: t('flashcards.tone.name5') }
	];

	// Contours in a 100×100 box, y down (Chao tone letters 55, 35, 214, 51); shared with the tone-pair drill.
	const CONTOUR = TONE_CONTOURS;

	const credit = $derived(audio ? creditLine(audio.clips) : '');
	const candidates = $derived(toneCandidates(entry.readings));
	// The first clean reading decides the syllables shown; any reading
	// with the same syllable count is accepted when checking.
	const syllables = $derived(candidates[0] ?? []);
	const labels = $derived(tonePadLabels(entry.written, syllables.length));
	const allReadings = $derived(pinyinReadings(entry.readings));
	// Hidden romanisation (#284, owner decision): with pinyin hidden the card asks for the tones of the characters
	// and answers with tone numbers and contours; no pinyin letters, not in the accessible names either.
	const roman = useRomanisation();
	const showPinyin = $derived(roman.shows('pinyin'));
	const padText = (index: number, plain: string): string => labels?.[index] ?? (showPinyin ? plain : '');
	// Tone sandhi (#300): by default the citation or the spoken tone is right; the workspace can grade spoken tones
	// only, and show or never show the spoken tone beside the citation tone on the answer.
	const toneSettings = $derived(readToneSettings(session.workspaces.current?.settings));

	let chosen = $state<(Tone | null)[]>([]);
	let active = $state(0);
	let verdict = $state<ToneVerdict | null>(null);
	let trace = $state<GesturePoint[]>([]);
	let tracing = $state<number | null>(null);
	// The tone whose contour is drawing in on a pad, and the pad's drawn tone.
	let drawing = $state<number | null>(null);
	const reduceMotion =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	let drawTimer: ReturnType<typeof setTimeout> | null = null;
	onDestroy(() => {
		if (drawTimer !== null) clearTimeout(drawTimer);
	});
	let announcement = $state('');
	let pads = $state<(HTMLElement | null)[]>([]);

	$effect(() => {
		// One slot per syllable; the card is keyed per item, so this runs once.
		const count = syllables.length;
		chosen = Array.from({ length: count }, () => null);
	});

	const complete = $derived(chosen.length > 0 && chosen.every((tone) => tone !== null));

	function nameOf(tone: Tone): string {
		return TONES[tone - 1].name;
	}

	function setTone(index: number, tone: Tone): void {
		if (done || index < 0 || index >= chosen.length) return;
		chosen = chosen.map((current, i) => (i === index ? tone : current));
		announcement = t('flashcards.tone.announce', { n: index + 1, tone: nameOf(tone) });
		if (index === active && active < chosen.length - 1) active += 1;
	}

	function check(): void {
		if (done || !complete) return;
		const result = toneVerdict(chosen as Tone[], candidates, { chars: labels, gradeSpoken: toneSettings.gradeSpoken });
		verdict = result;
		announcement = result.correct ? t('flashcards.card.correct') : t('flashcards.tone.wrong', { count: result.wrong });
		onDone({ suggested: suggestToneGrade(result.wrong), meta: { mistakes: result.wrong } });
	}

	// The docked primary (#101): Check, disabled until every syllable has a tone.
	usePrimary(() => (done ? null : { label: t('flashcards.card.check'), run: check, disabled: !complete }));

	function point(event: PointerEvent, pad: HTMLElement): GesturePoint {
		const rect = pad.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function onPointerDown(event: PointerEvent, index: number): void {
		// Primary pointer only, and for a mouse only the main button: a
		// right-click must not set a tone.
		if (done || !event.isPrimary) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const pad = event.currentTarget as HTMLElement;
		event.preventDefault();
		pad.setPointerCapture(event.pointerId);
		active = index;
		tracing = index;
		trace = [point(event, pad)];
	}

	function onPointerMove(event: PointerEvent, index: number): void {
		if (tracing !== index || !event.isPrimary) return;
		trace = [...trace, point(event, event.currentTarget as HTMLElement)];
	}

	function onPointerUp(event: PointerEvent, index: number): void {
		if (tracing !== index || !event.isPrimary) return;
		const path = [...trace, point(event, event.currentTarget as HTMLElement)];
		tracing = null;
		trace = [];
		const tone = toneFromGesture(path);
		if (!reduceMotion) {
			drawing = index;
			if (drawTimer !== null) clearTimeout(drawTimer);
			drawTimer = setTimeout(() => {
				drawTimer = null;
				if (drawing === index) drawing = null;
			}, 120);
		}
		setTone(index, tone);
	}

	function onPointerCancel(): void {
		tracing = null;
		trace = [];
	}

	function isTextField(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLElement &&
			target.closest('input, textarea, select, [contenteditable="true"]') !== null
		);
	}

	function isActivatable(target: EventTarget | null): boolean {
		return target instanceof HTMLElement && target.closest('button, a') !== null;
	}

	/**
	 * Until the answer is checked this card owns the keyboard: 1–5 set the
	 * highlighted syllable's tone, arrows move, Backspace clears, Enter
	 * checks. The runner ignores keys while a tone card is unchecked.
	 */
	function onKeydown(event: KeyboardEvent): void {
		if (done || event.defaultPrevented || event.repeat) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTextField(event.target)) return;

		if (/^[1-5]$/.test(event.key)) {
			event.preventDefault();
			setTone(active, Number(event.key) as Tone);
			return;
		}
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				active = Math.max(0, active - 1);
				return;
			case 'ArrowRight':
				event.preventDefault();
				active = Math.min(chosen.length - 1, active + 1);
				return;
			case 'Backspace':
				event.preventDefault();
				if (chosen[active] === null && active > 0) active -= 1;
				chosen = chosen.map((tone, i) => (i === active ? null : tone));
				return;
			case 'Enter':
				// A focused button activates natively; do not check twice.
				if (isActivatable(event.target)) return;
				event.preventDefault();
				check();
				return;
		}
	}

	function polyline(points: GesturePoint[], pad: HTMLElement | null): string {
		if (pad === null) return '';
		const { width, height } = pad.getBoundingClientRect();
		if (width === 0 || height === 0) return '';
		return points.map((p) => `${(p.x / width) * 100},${(p.y / height) * 100}`).join(' ');
	}

</script>

<svelte:window onkeydown={onKeydown} />

<FacePrompt>
	<p class="fp-word written" lang={textLang}>{entry.written}</p>
	<p class="fp-sub prompt">{t('flashcards.tone.prompt')}</p>
	{#if toneSettings.gradeSpoken}<p class="fp-sub prompt">{t('flashcards.tone.gradesSpoken')}</p>{/if}
	<HintShown {entry} />
</FacePrompt>

<FaceWork>
<HintControl />
<ol class="syllables" aria-label={t('flashcards.tone.syllables')} data-card-input>
	{#each syllables as syllable, index (index)}
		{@const tone = chosen[index] ?? null}
		{@const mark = verdict?.marks[index]}
		<li class="syllable" class:active={index === active && !done}>
			<div
				class="pad"
				class:right={mark === true}
				class:wrong={mark === false}
				bind:this={pads[index]}
				role="img"
				aria-label={padText(index, syllable.plain) === ''
					? t('flashcards.tone.padLabelN', { n: index + 1, tone: tone === null ? t('flashcards.tone.noTone') : nameOf(tone) })
					: t('flashcards.tone.padLabel', {
							n: index + 1,
							syllable: padText(index, syllable.plain),
							tone: tone === null ? t('flashcards.tone.noTone') : nameOf(tone)
						})}
				onpointerdown={(event) => onPointerDown(event, index)}
				onpointermove={(event) => onPointerMove(event, index)}
				onpointerup={(event) => onPointerUp(event, index)}
				onpointercancel={onPointerCancel}
			>
				<svg viewBox="0 0 100 100" aria-hidden="true" class="contour">
					{#if tone !== null}
						{#if tone === 5}
							<circle cx="50" cy="56" r="7" />
						{:else}
							<path d={CONTOUR[tone]} class:draw={drawing === index} pathLength="1" />
						{/if}
					{/if}
					{#if tracing === index && trace.length > 1}
						<polyline class="trace" points={polyline(trace, pads[index] ?? null)} />
					{/if}
				</svg>
				{#if mark === true}<span class="mark"><Icon name="check" size="s" /></span>{:else if mark === false}<span class="mark"><Icon name="close" size="s" /></span>{/if}
				{#if padText(index, syllable.plain) !== ''}<span class="plain" class:char={labels !== null} lang={labels === null ? readingLang('pinyin', entry.language) : textLang}>{padText(index, syllable.plain)}</span>{/if}
			</div>
			<div class="tone-buttons" role="group" aria-label={labels === null && showPinyin
					? t('flashcards.tone.toneFor', { syllable: syllable.plain })
					: t('flashcards.tone.toneForN', { n: index + 1 })}>
				{#each TONES as option (option.tone)}
					<button
						type="button"
						class:selected={tone === option.tone}
						aria-pressed={tone === option.tone}
						aria-label={t('flashcards.tone.button', { tone: option.tone, name: option.name })}
						disabled={done}
						onclick={() => {
							active = index;
							setTone(index, option.tone);
						}}
					>
						<span aria-hidden="true">{option.tone}{option.glyph}</span>
					</button>
				{/each}
			</div>
			{#if verdict !== null}
				{@const answer = verdict.best?.[index] ?? syllable}
				{@const spokenTone = verdict.spoken?.[index] ?? answer.tone}
				{@const sandhi = toneSettings.showSandhi && spokenTone !== answer.tone}
				<p
					class="answer"
					class:right={mark === true}
					class:wrong={mark === false}
					data-answer-tone={answer.tone}
					data-spoken-tone={spokenTone}
				>
					{#if showPinyin}
						<span class="citation">{answer.text}</span>
						{#if sandhi}
							<span class="spoken"
								><span aria-hidden="true" class="arrow">→</span><span aria-hidden="true" class="shown"
									>{markedSyllable(answer.plain, spokenTone)}</span
								><span class="sr-only">{t('flashcards.tone.spokenAs', { tone: markedSyllable(answer.plain, spokenTone) })}</span></span
							>
						{/if}
					{:else}
						<span class="citation">
							<span aria-hidden="true">{answer.tone}{TONES[answer.tone - 1].glyph}</span>
							<ToneContour tone={answer.tone} />
							<span class="sr-only">{nameOf(answer.tone)}</span>
						</span>
						{#if sandhi}
							<span class="spoken">
								<span aria-hidden="true" class="arrow">→</span>
								<span aria-hidden="true" class="shown">{spokenTone}{TONES[spokenTone - 1].glyph}</span>
								<ToneContour tone={spokenTone} />
								<span class="sr-only">{t('flashcards.tone.spokenAs', { tone: nameOf(spokenTone) })}</span>
							</span>
						{/if}
					{/if}
				</p>
			{/if}
		</li>
	{/each}
</ol>

<p class="feedback" class:bad={verdict !== null && !verdict.correct} role="status" aria-live="polite">
	{announcement}
</p>
</FaceWork>

{#if done}
	<FaceAnswer>
		<div class="fa-readings">
			<ReadingTable
				readings={allReadings.map((value) => ({ type: 'pinyin', value }))}
				language={entry.language}
				label={t('flashcards.card.readings')}
				emphasis
			/>
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
		{#if credit}
			<p class="credit fa-source">{credit}</p>
		{/if}
	</FaceAnswer>
{/if}

<style>
	.written {
		margin: 0;
	}

	.prompt {
		max-width: 26rem;
	}

	.syllables {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.syllable {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
	}

	.pad {
		position: relative;
		box-sizing: border-box;
		width: 6.875rem;
		height: 6.875rem;
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		--contour: var(--accent);
		display: grid;
		place-items: center;
		cursor: crosshair;
		/* Swipes are gestures, never scrolls. */
		touch-action: none;
		user-select: none;
	}

	.syllable.active .pad {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 0.5px var(--accent);
	}

	.pad.right {
		--contour: var(--good);
		border-color: var(--good);
		box-shadow: inset 0 0 0 0.5px var(--good);
	}

	.pad.wrong {
		--contour: var(--bad);
		border-color: var(--bad);
		box-shadow: inset 0 0 0 0.5px var(--bad);
	}

	.contour {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		fill: none;
		stroke: var(--contour);
		stroke-width: 6;
		stroke-linecap: round;
	}

	.contour path {
		stroke-dasharray: 1;
	}

	.contour path.draw {
		animation: draw-in 120ms linear;
	}

	@keyframes draw-in {
		from {
			stroke-dashoffset: 1;
		}
		to {
			stroke-dashoffset: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.contour path.draw {
			animation: none;
		}
	}

	.contour circle {
		fill: var(--contour);
		stroke: none;
	}

	.contour .trace {
		stroke: var(--line);
		stroke-width: 4;
	}

	.mark {
		position: absolute;
		top: var(--space-1);
		inset-inline-end: var(--space-1);
		display: inline-flex;
		color: var(--text);
	}

	.plain {
		position: relative;
		font-size: var(--font-size-m);
		font-weight: var(--weight-medium);
		color: var(--readable-muted);
	}

	.plain.char {
		font-family: var(--font-hanzi);
		font-size: 1.875rem;
		font-weight: var(--weight-regular);
		line-height: 1;
	}

	.tone-buttons {
		display: flex;
		gap: 0.125rem;
	}

	.tone-buttons button {
		min-width: 1.25rem;
		min-height: 1.5rem;
		padding: 0 0.125rem;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--readable-muted);
		font: inherit;
		font-size: var(--font-size-xs);
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

	.answer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		margin: 0;
		font-size: var(--font-size-m);
		font-weight: var(--weight-strong);
	}

	.citation,
	.spoken {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	/* Tone sandhi: the spoken tone after the citation tone, lighter. */
	.spoken {
		font-weight: var(--weight-regular);
	}

	.arrow {
		color: var(--readable-muted);
	}

	.right {
		color: var(--text);
	}

	.wrong {
		color: var(--readable-bad);
	}

	button:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.feedback {
		min-height: 1.4rem;
		margin: 0;
		font-weight: var(--weight-strong);
		color: var(--text);
		text-align: center;
	}

	.feedback.bad {
		color: var(--readable-bad);
	}

	@media (pointer: coarse) {
		.tone-buttons button {
			min-width: 2rem;
			min-height: var(--hit);
		}
	}

	@media (forced-colors: active) {
		.pad {
			border-color: ButtonText;
		}
		.syllable.active .pad,
		.pad.right {
			border: 2px solid Highlight;
		}
		.tone-buttons button.selected {
			text-decoration: underline;
		}
	}
</style>
