<script lang="ts">
	import { entrySenses, shownGlosses, unitsOf } from '$lib/entry/entrySenses';
	import { studyLang } from '$lib/i18n/lang';
	import { t } from '$lib/i18n';
	import { untrack } from 'svelte';
	import type { Entry } from '$lib/api/types';
	import { type CardResult, type FlowItem } from '../session/cardFlow';
	import { loadStrokeData } from '$lib/writing/strokeData';
	import { suggestWritingGrade, type CharOutcome, maskWritten } from '$lib/exercises/writing';
	import { parseStrokeData, type CharStrokes } from '$lib/writing/strokes';
	import { fitPad } from '$lib/writing/padSize';
	import WritingPad from './WritingPad.svelte';
	import Button from '$lib/ui/Button.svelte';
	import AnswerAids from '../face/AnswerAids.svelte';
	import FaceAnswer from '../face/FaceAnswer.svelte';
	import FacePrompt from '../face/FacePrompt.svelte';
	import FaceWork from '../face/FaceWork.svelte';
	import HintControl from '../face/HintControl.svelte';
	import HintShown from '../face/HintShown.svelte';
	import { usePrimary } from '../face/cardFace.svelte';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	interface Props {
		item: FlowItem;
		entry: Entry;
		/** Han characters of the word with stroke data, in order. */
		chars: string[];
		done: boolean;
		onDone: (result: CardResult) => void;
	}

	let { item, entry, chars, done, onDone }: Props = $props();

	// The pad's size follows the screen (#285, lib/writing/padSize.ts): the feedback line must stay above the
	// docked actions.
	let feedbackLine = $state<HTMLElement>();
	const padFit = {
		end: () => feedbackLine,
		dock: () => feedbackLine?.closest('.study-face')?.querySelector('[data-action-dock]')
	};

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
	// The prompt's meaning: shown glosses only, never a folded slang or vulgar one (docs/contracts/senses).
	const glosses = $derived(shownGlosses(unitsOf(entrySenses(entry), item.card?.reading), 3));

	async function loadChar(index: number): Promise<void> {
		busy = true;
		mistakes = 0;
		strokeNote = '';
		current = null;
		try {
			const ch = chars[index];
			const parsed = parseStrokeData(ch, await loadStrokeData(session.caches.strokes, ch, undefined, entry.language));
			if (!alive) return;
			if (parsed === null) throw new Error(`No stroke data for ${ch}`);
			current = parsed;
			busy = false;
			// Warm the cache for the next character of the word.
			if (index + 1 < chars.length) void loadStrokeData(session.caches.strokes, chars[index + 1], undefined, entry.language);
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

	// The docked primary (#101): Show strokes reveals the current character
	// (the give-up path; its suggestion is unchanged). Not offered while the
	// character's stroke data (the installed strokes pack) is loading or missing.
	usePrimary(() =>
		done || failed !== '' || current === null
			? null
			: { label: t('flashcards.writing.showStrokes'), run: reveal, disabled: busy }
	);

	function giveUpOnError(): void {
		onDone({ suggested: 1, meta: { mistakes: 0, hints: chars.length } });
	}
</script>

<FacePrompt>
	<p class="fp-word written" lang={studyLang(entry.language)} aria-label={done ? written : t('flashcards.writing.wordLabel')}>
		{masked}
	</p>
	<HintShown {entry} />
	{#if glosses.length > 0}
		<p class="fp-sub">{glosses.join('; ')}</p>
	{/if}
</FacePrompt>

<FaceWork>
	<HintControl />
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
			<Button variant="secondary" onclick={giveUpOnError}>{t('flashcards.writing.continue')}</Button>
		{/if}
	{/if}

	<div class="pad-wrap" class:hidden={failed !== ''} use:fitPad={padFit}>
		{#if current !== null}
			{#key current}
				<WritingPad
					strokes={current}
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
			<div class="pad-placeholder" data-card-input></div>
		{/if}
	</div>

	{#if !done && !failed}
		<div class="actions">
			<Button variant="secondary" disabled={busy} onclick={hint}>{t('flashcards.writing.strokeHint')}</Button>
			<span class="count" aria-hidden="true">{t('flashcards.writing.mistakes', { count: mistakes })}</span>
		</div>
	{/if}

	{#if !done}
		<p class="feedback" role="status" aria-live="polite" bind:this={feedbackLine}>{feedback}</p>
	{/if}
	<p class="sr-only" aria-live="polite">{strokeNote}</p>
</FaceWork>

{#if done && feedback}
	<FaceAnswer>
		<p class="fa-source">{feedback}</p>
		<AnswerAids {entry} {chars} />
	</FaceAnswer>
{/if}

<style>
	.written {
		letter-spacing: 0.05em;
	}

	.dots {
		display: flex;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.dot {
		box-sizing: border-box;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--line);
	}

	.dot.current {
		background: var(--accent);
		outline: 1px solid var(--accent);
		outline-offset: 2px;
	}

	.dot.ok {
		background: var(--good);
	}

	.dot.missed {
		background: var(--warn);
	}

	.dot.revealed {
		background: transparent;
		border: 1.5px solid var(--bad);
	}

	.pad-wrap {
		/* Until fitPad has measured: today's size. */
		width: 12.5rem;
		max-width: 100%;
	}

	.pad-wrap.hidden {
		display: none;
	}

	.pad-placeholder {
		width: 100%;
		aspect-ratio: 1;
		box-sizing: border-box;
		border: 1px solid var(--hair);
		border-radius: var(--radius);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
	}

	.count {
		color: var(--readable-muted);
		font-size: var(--font-size-label);
		font-variant-numeric: tabular-nums;
	}

	.feedback {
		min-height: 1.4rem;
		margin: 0;
		font-weight: var(--weight-strong);
		text-align: center;
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
		margin: 0;
		color: var(--readable-bad);
		font-weight: var(--weight-strong);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	@media (forced-colors: active) {
		.dot {
			forced-color-adjust: none;
			background: CanvasText;
		}
		.dot.current {
			background: Highlight;
			outline-color: Highlight;
		}
	}
</style>
