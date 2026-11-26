<script lang="ts">
	// The write mode of the trainer (#62): one kana drawn stroke by stroke on the writing pad the flashcards use. The
	// stroke data comes from the server's Japanese stroke pack (KanjiVG), asked for in the language of the system.
	// The pad judges the strokes; this component only loads the data, offers the stroke hint and the reveal, and
	// reports the outcome once the glyph is finished.
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import { fetchStrokeData } from '$lib/study/strokeData';
	import type { CharOutcome } from '$lib/study/writing';
	import { parseStrokeData, type CharStrokes } from '$lib/writing/strokes';
	import WritingPad from '$lib/features/flashcards/cards/WritingPad.svelte';
	import Button from '$lib/ui/Button.svelte';

	let {
		glyph,
		sound,
		language,
		done,
		onfinish,
		onskip
	}: {
		glyph: string;
		/** What the learner is asked to write (the romanisation), for the pad's label. */
		sound: string;
		language: string;
		/** The question is answered: the pad shows the finished glyph and nothing is offered. */
		done: boolean;
		onfinish: (outcome: CharOutcome, hints: number) => void;
		/** The stroke data is not there: leave this letter out of the round, uncounted. */
		onskip: () => void;
	} = $props();

	// 12.5rem at the default font size, as the flashcards' writing pad.
	const SIZE = 200;

	const session = useSession();
	let phase = $state<'loading' | 'ready' | 'missing' | 'failed'>('loading');
	let strokes = $state.raw<CharStrokes | null>(null);
	let revealSignal = $state(0);
	let hintSignal = $state(0);
	let mistakes = $state(0);
	let attempt = $state(0);
	let finished = $state(false);

	$effect(() => {
		const ch = glyph;
		const lang = language;
		void attempt;
		let cancelled = false;
		untrack(() => {
			phase = 'loading';
			strokes = null;
		});
		void fetchStrokeData(session.caches.strokes, ch, undefined, lang).then((result) => {
			if (cancelled) return;
			if (result.kind === 'missing') {
				phase = 'missing';
				return;
			}
			if (result.kind === 'error') {
				phase = 'failed';
				return;
			}
			const parsed = parseStrokeData(ch, result.data);
			strokes = parsed;
			phase = parsed === null ? 'missing' : 'ready';
		});
		return () => {
			cancelled = true;
		};
	});

	function complete(outcome: CharOutcome, hints: number): void {
		finished = true;
		onfinish(outcome, hints);
	}
</script>

<div class="write">
	{#if phase === 'loading'}
		<p class="note" role="status">{t('scripts.write.loading')}</p>
	{:else if phase === 'missing'}
		<p class="note" role="alert">{t('scripts.write.unavailable')}</p>
		<Button variant="secondary" onclick={onskip}>{t('scripts.write.skip')}</Button>
	{:else if phase === 'failed'}
		<p class="note" role="alert">{t('scripts.write.failed')}</p>
		<div class="actions">
			<Button variant="secondary" onclick={() => (attempt += 1)}>{t('scripts.write.retry')}</Button>
			<Button variant="plain" onclick={onskip}>{t('scripts.write.skip')}</Button>
		</div>
	{:else if strokes !== null}
		<div class="pad" style:max-width={`${SIZE / 16}rem`}>
			{#key strokes}
				<WritingPad
					{strokes}
					size={SIZE}
					onComplete={complete}
					onChange={(progress) => (mistakes = progress.mistakes)}
					{revealSignal}
					{hintSignal}
					label={done ? t('scripts.write.padLabelDone', { glyph }) : t('scripts.write.padLabel', { sound })}
				/>
			{/key}
		</div>
		{#if !done && !finished}
			<div class="actions">
				<Button variant="secondary" onclick={() => (hintSignal += 1)}>{t('scripts.write.hint')}</Button>
				<Button variant="plain" onclick={() => (revealSignal += 1)}>{t('scripts.write.show')}</Button>
				<span class="count" role="status" aria-live="polite">{mistakes > 0 ? t('scripts.write.wrongStroke', { count: mistakes }) : ''}</span>
			</div>
		{/if}
	{/if}
</div>

<style>
	.write {
		display: grid;
		gap: var(--space-3);
	}

	.note {
		margin: 0;
		color: var(--readable-muted);
	}

	.pad {
		width: 100%;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.count {
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
</style>
