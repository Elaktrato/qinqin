<script lang="ts">
	import type HanziWriter from 'hanzi-writer';
	import type { CharacterJson, StrokeData } from 'hanzi-writer';
	import type { Entry } from '$lib/api/types';
	import { formatReading } from '$lib/format';
	import { captureListeners, maskWritten, type CardResult, type FlowItem } from '$lib/study/cardFlow';
	import { loadStrokeData } from '$lib/study/strokeData';
	import { quizOptions, suggestWritingGrade, type CharOutcome } from '$lib/study/writing';

	interface Props {
		item: FlowItem;
		entry: Entry;
		/** Han characters of the word with stroke data, in order. */
		chars: string[];
		done: boolean;
		onDone: (result: CardResult) => void;
	}

	let { item, entry, chars, done, onDone }: Props = $props();

	const SIZE = 260;

	let host = $state<HTMLDivElement | null>(null);
	let position = $state(0);
	let outcomes = $state<CharOutcome[]>([]);
	let mistakes = $state(0);
	let outlineShown = $state(false);
	let hintCount = $state(0);
	let busy = $state(true);
	let failed = $state('');
	let feedback = $state('');

	// Not reactive: the writer is driven imperatively.
	let writer: HanziWriter | null = null;
	let strokes = 0;
	let alive = true;

	const written = $derived(item.written ?? entry.written);
	const masked = $derived(maskWritten(written, chars, done ? chars.length : position));
	const glosses = $derived(entry.senses.slice(0, 3).map((sense) => sense.gloss));

	async function strokeCount(ch: string): Promise<number> {
		const data = (await loadStrokeData(ch)) as { strokes?: unknown[] } | null;
		return Array.isArray(data?.strokes) ? data.strokes.length : 0;
	}

	function record(outcome: CharOutcome): void {
		outcomes = [...outcomes, outcome];
		const next = position + 1;
		if (next >= chars.length) {
			position = chars.length;
			busy = false;
			writer?.cancelQuiz();
			onDone({
				suggested: suggestWritingGrade(outcomes),
				meta: {
					mistakes: outcomes.reduce((sum, o) => sum + o.mistakes, 0),
					hints: hintCount + outcomes.filter((o) => o.revealed).length
				}
			});
			return;
		}
		position = next;
		void startChar(next);
	}

	async function startChar(index: number): Promise<void> {
		const active = writer;
		if (active === null || !alive) return;
		const ch = chars[index];
		busy = true;
		mistakes = 0;
		outlineShown = false;
		strokes = await strokeCount(ch);
		if (!alive || writer !== active) return;
		await active.setCharacter(ch);
		if (!alive || writer !== active) return;
		busy = false;
		void active.quiz({
			...quizOptions(),
			onMistake: (data: StrokeData) => {
				mistakes = data.totalMistakes;
				feedback = `Not that stroke. Mistakes: ${data.totalMistakes}.`;
				// Recall first; after the first hint streak the outline
				// appears as a scaffold for the rest of the character.
				if (!outlineShown && data.mistakesOnStroke >= quizOptions().showHintAfterMisses) {
					outlineShown = true;
					hintCount += 1;
					void active.showOutline();
				}
			},
			onCorrectStroke: (data: StrokeData) => {
				mistakes = data.totalMistakes;
				feedback = data.strokesRemaining > 0 ? '' : 'Character done.';
			},
			onComplete: (summary) => {
				if (!alive || writer !== active) return;
				record({ char: ch, mistakes: summary.totalMistakes, strokes, revealed: false });
			}
		});
	}

	async function reveal(): Promise<void> {
		const active = writer;
		if (active === null || busy || done || position >= chars.length) return;
		busy = true;
		active.cancelQuiz();
		feedback = `The character is ${chars[position]}.`;
		const outcome: CharOutcome = { char: chars[position], mistakes, strokes, revealed: true };
		await active.animateCharacter();
		if (!alive || writer !== active) return;
		record(outcome);
	}

	$effect(() => {
		const node = host;
		if (node === null) return;
		alive = true;
		let cancelled = false;
		let release: (() => void) | null = null;

		void (async () => {
			try {
				const module = await import('hanzi-writer');
				if (cancelled) return;
				// hanzi-writer adds document listeners in its constructor and
				// has no destroy(); capture them so unmount removes them.
				const captured = captureListeners(document, () =>
					module.default.create(node, chars[0], {
						width: SIZE,
						height: SIZE,
						padding: 12,
						showOutline: false,
						showCharacter: false,
						strokeColor: '#0b6bcb',
						outlineColor: '#9aa0a6',
						drawingColor: '#6b7280',
						charDataLoader: (ch, onLoad, onError) => {
							void loadStrokeData(ch).then((data) =>
								data ? onLoad(data as CharacterJson) : onError()
							);
						}
					})
				);
				release = captured.release;
				writer = captured.result;
				await startChar(0);
			} catch {
				if (!cancelled) {
					failed = 'The writing pad could not start. Grade this card yourself.';
					busy = false;
				}
			}
		})();

		return () => {
			cancelled = true;
			alive = false;
			const active = writer;
			writer = null;
			if (active !== null) {
				active.cancelQuiz();
				void active.pauseAnimation().catch(() => {});
			}
			release?.();
			node.replaceChildren();
		};
	});

	function giveUpOnError(): void {
		onDone({ suggested: 1, meta: { mistakes: 0, hints: chars.length } });
	}
</script>

<p class="written" aria-label={done ? written : 'The word to write; boxes mark the characters to draw'}>
	{masked}
</p>

{#if entry.readings.length > 0}
	<ul class="readings" aria-label="Readings">
		{#each entry.readings as reading, readingIndex (`${reading.type}:${readingIndex}`)}
			<li>{formatReading(reading.type, reading.value)}</li>
		{/each}
	</ul>
{/if}

{#if glosses.length > 0}
	<p class="glosses">{glosses.join('; ')}</p>
{/if}

<ol class="dots" aria-label="Characters">
	{#each chars as ch, index (index)}
		{@const outcome = outcomes[index]}
		<li
			class="dot"
			class:current={index === position && !done}
			class:ok={outcome !== undefined && !outcome.revealed && outcome.mistakes === 0}
			class:missed={outcome !== undefined && !outcome.revealed && outcome.mistakes > 0}
			class:revealed={outcome?.revealed}
			aria-label={outcome === undefined
				? `Character ${index + 1}${index === position ? ', current' : ''}`
				: `${ch}: ${outcome.revealed ? 'revealed' : `${outcome.mistakes} mistakes`}`}
		></li>
	{/each}
</ol>

{#if failed}
	<p class="error" role="alert">{failed}</p>
	{#if !done}
		<button type="button" class="secondary" onclick={giveUpOnError}>Continue</button>
	{/if}
{/if}

<div class="pad-wrap" class:hidden={failed !== ''}>
	<div
		class="pad"
		bind:this={host}
		data-card-input
		style:width={`${SIZE}px`}
		style:height={`${SIZE}px`}
		role="application"
		aria-roledescription="writing pad"
		aria-label={done
			? `Written: ${written}`
			: `Draw character ${Math.min(position + 1, chars.length)} of ${chars.length}, stroke by stroke`}
	></div>
</div>

{#if !done && !failed}
	<div class="actions">
		<button type="button" class="secondary" disabled={busy} onclick={() => void reveal()}>
			Reveal character
		</button>
		<span class="count" aria-hidden="true">Mistakes: {mistakes}</span>
	</div>
{/if}

<p class="feedback" role="status" aria-live="polite">{feedback}</p>

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

	.pad {
		max-width: 100%;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.4rem;
		/* Grid guide: a centre cross, like practice paper. */
		background:
			linear-gradient(color-mix(in srgb, currentColor 10%, transparent), color-mix(in srgb, currentColor 10%, transparent))
				center / 1px 100% no-repeat,
			linear-gradient(color-mix(in srgb, currentColor 10%, transparent), color-mix(in srgb, currentColor 10%, transparent))
				center / 100% 1px no-repeat;
		/* The pad owns every pointer gesture: no scrolling or zooming. */
		touch-action: none;
		user-select: none;
	}

	.actions {
		display: flex;
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

	.error {
		margin: 0.5rem 0;
		color: #c62828;
		font-weight: 600;
	}
</style>
