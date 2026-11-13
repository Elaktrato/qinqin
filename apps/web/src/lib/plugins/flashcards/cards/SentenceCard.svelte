<script lang="ts">
	import { segmentBatch } from '$lib/api/segment';
	import type { Entry, Sentence } from '$lib/api/types';
	import type { CardResult, FlowItem } from '$lib/study/cardFlow';
	import {
		isCorrect,
		loadTokens,
		shuffleTokens,
		splitWithin,
		suggestSaladGrade,
		type SaladTier
	} from '$lib/study/wordSalad';

	interface Props {
		item: FlowItem;
		entry: Entry;
		sentence: Sentence;
		tier: SaladTier;
		/** Shuffle seed: the card id plus its review count. */
		seed: string;
		language: string;
		done: boolean;
		onDone: (result: CardResult) => void;
	}

	let { item, entry, sentence, tier, seed, language, done, onDone }: Props = $props();

	// The order the learner must rebuild, and the shuffled bank. Bank ids
	// are positions in `bank`, so duplicate tokens stay distinct tiles.
	let solution = $state<string[] | null>(null);
	let bank = $state<string[]>([]);
	let placed = $state<number[]>([]);
	let wrongChecks = $state(0);
	let translationShown = $state(false);
	let gaveUp = $state(false);
	let solved = $state(false);
	let feedback = $state('');

	const hidesTranslation = $derived(tier > 0);
	const available = $derived(bank.map((_, id) => id).filter((id) => !placed.includes(id)));
	const complete = $derived(solution !== null && placed.length === bank.length);

	$effect(() => {
		const text = sentence.hanzi;
		const lang = language;
		const level = tier;
		const shuffleSeed = seed;
		let cancelled = false;
		void loadTokens(lang, text, (l, t) => segmentBatch(l, t)).then((tokens) => {
			if (cancelled) return;
			const order = level === 2 ? splitWithin(tokens) : tokens;
			solution = order;
			bank = shuffleTokens(order, shuffleSeed);
			placed = [];
		});
		return () => {
			cancelled = true;
		};
	});

	function place(id: number): void {
		if (done) return;
		feedback = '';
		placed = [...placed, id];
	}

	function unplace(id: number): void {
		if (done) return;
		feedback = '';
		placed = placed.filter((placedId) => placedId !== id);
	}

	function undo(): void {
		if (done || placed.length === 0) return;
		feedback = '';
		placed = placed.slice(0, -1);
	}

	function hints(): number {
		return (translationShown ? 1 : 0) + (gaveUp ? 1 : 0);
	}

	function finish(): void {
		onDone({
			suggested: suggestSaladGrade({ wrongChecks, revealed: gaveUp }),
			meta: { tier, mistakes: wrongChecks, hints: hints() }
		});
	}

	function check(): void {
		if (done || solution === null || !complete) return;
		if (isCorrect(
			placed.map((id) => bank[id]),
			solution
		)) {
			solved = true;
			feedback = wrongChecks === 0 ? 'Correct!' : 'Correct.';
			finish();
			return;
		}
		wrongChecks += 1;
		feedback = `Not quite. Wrong checks: ${wrongChecks}.`;
	}

	function giveUp(): void {
		if (done) return;
		gaveUp = true;
		feedback = 'Here is the sentence.';
		finish();
	}

	function showTranslation(): void {
		translationShown = true;
	}
</script>

<div class="prompt">
	{#if !hidesTranslation || translationShown || done}
		<p class="translation">{sentence.translation || 'No translation for this sentence.'}</p>
	{:else}
		<button type="button" class="cloze" onclick={showTranslation}>
			<span aria-hidden="true" class="blur">{sentence.translation || '—'}</span>
			<span class="cloze-label">Show translation (counts as a hint)</span>
		</button>
	{/if}
	<p class="target">Uses <strong lang={language}>{entry.written}</strong></p>
</div>

{#if solution === null}
	<p class="hint" role="status">Preparing the sentence…</p>
{:else}
	<div class="board" data-card-input>
		<ol class="answer" aria-label="Your sentence" lang={language}>
			{#each placed as id (id)}
				<li>
					<button
						type="button"
						class="token placed"
						class:right={solved}
						disabled={done}
						aria-label={`Remove ${bank[id]}`}
						onclick={() => unplace(id)}>{bank[id]}</button
					>
				</li>
			{:else}
				<li class="empty">Tap the words below in order.</li>
			{/each}
		</ol>

		<ul class="bank" aria-label="Word tiles" lang={language}>
			{#each available as id (id)}
				<li>
					<button
						type="button"
						class="token"
						disabled={done}
						aria-label={`Place ${bank[id]}`}
						onclick={() => place(id)}>{bank[id]}</button
					>
				</li>
			{/each}
		</ul>

		{#if !done}
			<div class="actions">
				<button type="button" class="secondary" disabled={placed.length === 0} onclick={undo}>
					Undo
				</button>
				<button type="button" class="primary" disabled={!complete} onclick={check}>Check</button>
				<button type="button" class="secondary" onclick={giveUp}>Show answer</button>
			</div>
		{/if}
	</div>
{/if}

<p class="feedback" class:bad={wrongChecks > 0 && !solved} role="status" aria-live="polite">
	{feedback}
</p>

{#if done}
	<section class="reveal" aria-label="The sentence">
		<p class="sentence" lang={language}>{sentence.hanzi}</p>
		{#if sentence.pinyin}
			<p class="pinyin">{sentence.pinyin}</p>
		{/if}
		{#if sentence.translation}
			<p class="translation">{sentence.translation}</p>
		{/if}
	</section>
{/if}

<style>
	.prompt {
		display: grid;
		gap: 0.5rem;
	}

	.translation {
		margin: 0;
		font-size: 1.15rem;
	}

	.target {
		margin: 0;
		opacity: 0.75;
	}

	.cloze {
		position: relative;
		display: grid;
		justify-items: start;
		padding: 0.5rem 0.75rem;
		border: 1px dashed color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.blur {
		filter: blur(6px);
		user-select: none;
	}

	.cloze-label {
		margin-top: 0.25rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #0b6bcb;
	}

	.hint {
		opacity: 0.75;
	}

	.board {
		margin-top: 1.25rem;
		display: grid;
		gap: 1rem;
	}

	.answer,
	.bank {
		list-style: none;
		margin: 0;
		padding: 0.6rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		min-height: 3.2rem;
		border-radius: 0.4rem;
	}

	.answer {
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
	}

	.empty {
		align-self: center;
		opacity: 0.6;
	}

	.token {
		padding: 0.4rem 0.7rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: color-mix(in srgb, currentColor 6%, transparent);
		color: inherit;
		font: inherit;
		font-size: 1.25rem;
		cursor: pointer;
	}

	.token.placed {
		background: color-mix(in srgb, #0b6bcb 12%, transparent);
	}

	.token.right {
		border-color: #2e7d32;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.actions button {
		padding: 0.45rem 0.9rem;
		border-radius: 0.4rem;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.primary {
		border: 0;
		background: #0b6bcb;
		color: #fff;
	}

	.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	button:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.token:hover:not(:disabled),
	.secondary:hover:not(:disabled) {
		border-color: #0b6bcb;
	}

	.feedback {
		min-height: 1.4rem;
		margin: 0.75rem 0 0;
		font-weight: 600;
		color: #2e7d32;
	}

	.feedback.bad {
		color: #c62828;
	}

	.reveal {
		margin-top: 1rem;
		border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		padding-top: 1rem;
		display: grid;
		gap: 0.35rem;
	}

	.reveal p {
		margin: 0;
	}

	.sentence {
		font-size: 1.35rem;
	}

	.pinyin {
		opacity: 0.8;
	}
</style>
