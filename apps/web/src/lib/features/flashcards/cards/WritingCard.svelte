<script lang="ts">
	import ReadingText from '$lib/components/ReadingText.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import { t } from '$lib/i18n';
	import { untrack } from 'svelte';
	import type { Entry } from '$lib/api/types';
	import { maskWritten, type CardResult, type FlowItem } from '$lib/study/cardFlow';
	import { loadStrokeData } from '$lib/study/strokeData';
	import { suggestWritingGrade, type CharOutcome } from '$lib/study/writing';
	import { parseStrokeData, type CharStrokes } from '$lib/writing/strokes';
	import WritingPad from './WritingPad.svelte';

	interface Props {
		item: FlowItem;
		entry: Entry;
		/** Han characters of the word with stroke data, in order. */
		chars: string[];
		done: boolean;
		onDone: (result: CardResult) => void;
	}

	let { item, entry, chars, done, onDone }: Props = $props();

	const SIZE = 280;

	let position = $state(0);
	let outcomes = $state<CharOutcome[]>([]);
	let mistakes = $state(0);
	let hintCount = $state(0);
	let busy = $state(true);
	let failed = $state('');
	let feedback = $state('');
	// Polite live region for accepted strokes (misses are announced through `feedback`).
	let strokeNote = $state('');
	let current = $state<CharStrokes | null>(null);
	let revealSignal = $state(0);
	let hintSignal = $state(0);

	// Long enough to see the finished character before the pad clears.
	const NEXT_CHAR_DELAY_MS = 600;
	let nextTimer: ReturnType<typeof setTimeout> | null = null;
	let alive = true;

	function prefersReducedMotion(): boolean {
		try {
			return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		} catch {
			return false;
		}
	}

	function fail(): void {
		if (!alive) return;
		failed = t('flashcards.writing.loadFailed');
		busy = false;
	}

	const written = $derived(item.written ?? entry.written);
	const masked = $derived(maskWritten(written, chars, done ? chars.length : position));
	const glosses = $derived(entry.senses.slice(0, 3).map((sense) => sense.gloss));

	async function loadChar(index: number): Promise<void> {
		busy = true;
		mistakes = 0;
		strokeNote = '';
		current = null;
		try {
			const ch = chars[index];
			const parsed = parseStrokeData(ch, await loadStrokeData(ch));
			if (!alive) return;
			if (parsed === null) throw new Error(`No stroke data for ${ch}`);
			current = parsed;
			busy = false;
			// Warm the cache for the next character of the word.
			if (index + 1 < chars.length) void loadStrokeData(chars[index + 1]);
		} catch {
			fail();
		}
	}

	function onComplete(outcome: CharOutcome, hints: number): void {
		if (!alive) return;
		outcomes = [...outcomes, outcome];
		hintCount += hints;
		busy = true;
		const next = position + 1;
		if (next >= chars.length) {
			position = chars.length;
			feedback = outcome.revealed ? t('flashcards.writing.revealed', { char: outcome.char }) : t('flashcards.writing.done');
			onDone({
				suggested: suggestWritingGrade(outcomes),
				meta: {
					mistakes: outcomes.reduce((sum, o) => sum + o.mistakes, 0),
					hints: hintCount + outcomes.filter((o) => o.revealed).length
				}
			});
			return;
		}
		feedback = outcome.revealed ? t('flashcards.writing.revealed', { char: outcome.char }) : '';
		const advance = () => {
			nextTimer = null;
			if (!alive) return;
			position = next;
			void loadChar(next);
		};
		if (prefersReducedMotion()) advance();
		else nextTimer = setTimeout(advance, NEXT_CHAR_DELAY_MS);
	}

	function onChange(progress: { mistakes: number; remaining: number }): void {
		const changed = progress.mistakes !== mistakes;
		mistakes = progress.mistakes;
		if (changed) feedback = t('flashcards.writing.wrongStroke', { count: progress.mistakes });
		else if (progress.remaining === 0) feedback = t('flashcards.writing.done');
		else feedback = '';
		if (!changed && progress.remaining > 0) {
			strokeNote = t('flashcards.writing.strokeAccepted', { count: progress.remaining });
		}
	}

	$effect(() => {
		alive = true;
		untrack(() => void loadChar(0));
		return () => {
			alive = false;
			if (nextTimer !== null) {
				clearTimeout(nextTimer);
				nextTimer = null;
			}
		};
	});

	function reveal(): void {
		if (busy || done || current === null) return;
		busy = true;
		revealSignal += 1;
	}

	function hint(): void {
		if (busy || done || current === null) return;
		hintSignal += 1;
	}

	function giveUpOnError(): void {
		onDone({ suggested: 1, meta: { mistakes: 0, hints: chars.length } });
	}
</script>

<p class="written" lang={studyLang(entry.language)} aria-label={done ? written : t('flashcards.writing.wordLabel')}>
	{masked}
</p>

{#if entry.readings.length > 0}
	<ul class="readings" aria-label={t('flashcards.card.readings')}>
		{#each entry.readings as reading, readingIndex (`${reading.type}:${readingIndex}`)}
			<li><ReadingText type={reading.type} value={reading.value} language={entry.language} /></li>
		{/each}
	</ul>
{/if}

{#if glosses.length > 0}
	<p class="glosses">{glosses.join('; ')}</p>
{/if}

<ol class="dots" aria-label={t('flashcards.writing.characters')}>
	{#each chars as ch, index (index)}
		{@const outcome = outcomes[index]}
		<li
			class="dot"
			class:current={index === position && !done}
			class:ok={outcome !== undefined && !outcome.revealed && outcome.mistakes === 0}
			class:missed={outcome !== undefined && !outcome.revealed && outcome.mistakes > 0}
			class:revealed={outcome?.revealed}
			aria-label={outcome === undefined
				? index === position
					? t('flashcards.writing.dotCurrent', { n: index + 1 })
					: t('flashcards.writing.dot', { n: index + 1 })
				: outcome.revealed
					? t('flashcards.writing.dotRevealed', { char: ch })
					: t('flashcards.writing.dotMistakes', { char: ch, count: outcome.mistakes })}
		></li>
	{/each}
</ol>

{#if failed}
	<p class="error" role="alert">{failed}</p>
	{#if !done}
		<button type="button" class="secondary" onclick={giveUpOnError}>{t('flashcards.writing.continue')}</button>
	{/if}
{/if}

<div class="pad-wrap" class:hidden={failed !== ''}>
	{#if current !== null}
		{#key current}
			<WritingPad
				strokes={current}
				size={SIZE}
				{onComplete}
				{onChange}
				{revealSignal}
				{hintSignal}
				label={done
					? t('flashcards.writing.written', { word: written })
					: t('flashcards.writing.draw', { n: Math.min(position + 1, chars.length), total: chars.length })}
			/>
		{/key}
	{:else}
		<div class="pad-placeholder" style:max-width={`${SIZE}px`} data-card-input></div>
	{/if}
</div>

{#if !done && !failed}
	<div class="actions">
		<button type="button" class="secondary" disabled={busy} onclick={hint}>{t('flashcards.writing.hint')}</button>
		<button type="button" class="secondary" disabled={busy} onclick={reveal}>{t('flashcards.writing.reveal')}</button>
		<span class="count" aria-hidden="true">{t('flashcards.writing.mistakes', { count: mistakes })}</span>
	</div>
{/if}

<p class="feedback" role="status" aria-live="polite">{feedback}</p>
<p class="sr-only" aria-live="polite">{strokeNote}</p>

<style>
	.written {
		margin: 0;
		font-size: 2.75rem;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: 0.05em;
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

	.glosses {
		margin: 0.5rem 0 0;
	}

	.dots {
		list-style: none;
		display: flex;
		gap: 0.4rem;
		margin: 1rem 0 0;
		padding: 0;
	}

	.dot {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, currentColor 40%, transparent);
	}

	.dot.current {
		border-color: #0b6bcb;
	}

	.dot.ok {
		background: #2e7d32;
		border-color: #2e7d32;
	}

	.dot.missed {
		background: #ef8f00;
		border-color: #ef8f00;
	}

	.dot.revealed {
		background: #c62828;
		border-color: #c62828;
	}

	.pad-wrap {
		margin-top: 1rem;
	}

	.pad-wrap.hidden {
		display: none;
	}

	.pad-placeholder {
		width: 100%;
		aspect-ratio: 1;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.4rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		margin-top: 0.75rem;
	}

	.count {
		opacity: 0.75;
		font-variant-numeric: tabular-nums;
	}

	.secondary {
		padding: 0.45rem 0.9rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.secondary:hover:not(:disabled),
	.secondary:focus-visible {
		border-color: #0b6bcb;
		color: #0b6bcb;
	}

	.secondary:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.secondary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.feedback {
		min-height: 1.4rem;
		margin: 0.5rem 0 0;
		font-weight: 600;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.error {
		margin: 0.5rem 0;
		color: #c62828;
		font-weight: 600;
	}
</style>
