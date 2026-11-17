<script lang="ts">
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import { isCorrect, shuffleTokens } from '$lib/study/wordSalad';

	interface Props {
		/** The order the learner must rebuild. */
		solution: string[];
		/** Shuffle seed for the tile bank. */
		seed: string;
		/** True once the exercise is finished: the board is locked. */
		disabled: boolean;
		onResult: (r: { wrongChecks: number; gaveUp: boolean }) => void;
		/** BCP-47 language of the tiles. */
		language?: string;
	}

	let { solution, seed, disabled, onResult, language }: Props = $props();

	// Bank ids are positions in `bank`, so duplicate tokens stay distinct tiles.
	const bank = $derived(shuffleTokens(solution, seed));
	let placed = $state<number[]>([]);
	let wrongChecks = $state(0);
	let solved = $state(false);
	let feedback = $state('');

	const available = $derived(bank.map((_, id) => id).filter((id) => !placed.includes(id)));
	const complete = $derived(placed.length === bank.length);

	// A new sentence (or seed) starts with an empty answer row.
	$effect(() => {
		void bank;
		placed = [];
	});

	let bankList = $state<HTMLElement | null>(null);
	let answerList = $state<HTMLElement | null>(null);
	let checkButton = $state<HTMLButtonElement | null>(null);

	/**
	 * A tile button disappears when it moves between bank and answer, so
	 * keyboard focus is handed to the tile now at the same spot (or the
	 * last one), falling back to Check when the bank is empty.
	 */
	async function refocus(list: HTMLElement | null, at: number, fallback: HTMLElement | null) {
		await tick();
		const buttons = list === null ? [] : [...list.querySelectorAll<HTMLButtonElement>('button')];
		const target = buttons[Math.min(at, buttons.length - 1)] ?? fallback;
		target?.focus();
	}

	function place(id: number, keyboard: boolean): void {
		if (disabled) return;
		feedback = '';
		const at = available.indexOf(id);
		placed = [...placed, id];
		if (keyboard) void refocus(bankList, at, checkButton);
	}

	function unplace(id: number, keyboard: boolean): void {
		if (disabled) return;
		feedback = '';
		const at = placed.indexOf(id);
		placed = placed.filter((placedId) => placedId !== id);
		if (keyboard) void refocus(answerList, at, bankList?.querySelector('button') ?? null);
	}

	// A click with detail 0 comes from the keyboard (Enter/Space).
	function fromKeyboard(event: MouseEvent): boolean {
		return event.detail === 0;
	}

	function undo(): void {
		if (disabled || placed.length === 0) return;
		feedback = '';
		placed = placed.slice(0, -1);
	}

	function check(): void {
		if (disabled || !complete) return;
		if (
			isCorrect(
				placed.map((id) => bank[id]),
				solution
			)
		) {
			solved = true;
			feedback = wrongChecks === 0 ? t('flashcards.salad.correctClean') : t('flashcards.salad.correct');
			onResult({ wrongChecks, gaveUp: false });
			return;
		}
		wrongChecks += 1;
		feedback = t('flashcards.salad.wrong', { count: wrongChecks });
	}

	function giveUp(): void {
		if (disabled) return;
		feedback = t('flashcards.salad.gaveUp');
		onResult({ wrongChecks, gaveUp: true });
	}
</script>

<div class="board" data-card-input>
	<ol class="answer" aria-label={t('flashcards.salad.yourSentence')} lang={language} bind:this={answerList}>
		{#each placed as id (id)}
			<li>
				<button
					type="button"
					class="token placed"
					class:right={solved}
					{disabled}
					aria-label={t('flashcards.salad.remove', { word: bank[id] })}
					onclick={(event) => unplace(id, fromKeyboard(event))}>{bank[id]}</button
				>
			</li>
		{:else}
			<li class="empty">{t('flashcards.salad.empty')}</li>
		{/each}
	</ol>

	{#if !disabled}
		<!-- Hidden once finished: the full sentence is shown below. -->
		<ul class="bank" aria-label={t('flashcards.salad.tiles')} lang={language} bind:this={bankList}>
			{#each available as id (id)}
				<li>
					<button
						type="button"
						class="token"
						aria-label={t('flashcards.salad.place', { word: bank[id] })}
						onclick={(event) => place(id, fromKeyboard(event))}>{bank[id]}</button
					>
				</li>
			{/each}
		</ul>

		<div class="actions">
			<button type="button" class="secondary" disabled={placed.length === 0} onclick={undo}>
				{t('flashcards.salad.undo')}
			</button>
			<button
				type="button"
				class="primary"
				disabled={!complete}
				bind:this={checkButton}
				onclick={check}>{t('flashcards.card.check')}</button
			>
			<button type="button" class="secondary" onclick={giveUp}>{t('flashcards.card.showAnswer')}</button>
		</div>
	{/if}
</div>

<p class="feedback" class:bad={wrongChecks > 0 && !solved} role="status" aria-live="polite">
	{feedback}
</p>

<style>
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
		min-height: 44px;
		min-width: 44px;
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

	/* A finished sentence stays fully legible: locked, not faded. */
	.token.placed:disabled {
		opacity: 1;
		cursor: default;
		border-style: dashed;
		border-color: color-mix(in srgb, currentColor 45%, transparent);
	}

	.token.right,
	.token.placed.right:disabled {
		border-color: #2e7d32;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.actions button {
		min-height: 44px;
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
</style>
