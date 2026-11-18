<script lang="ts">
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import { isCorrect, shuffleTokens } from '$lib/study/wordSalad';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';

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
		/**
		 * The study face docks Check (#101): given, the board hands its Check
		 * (label, run, disabled) here instead of rendering it; null once locked.
		 */
		dockCheck?: (check: { label: string; run: () => void; disabled: boolean } | null) => void;
	}

	let { solution, seed, disabled, onResult, language, dockCheck }: Props = $props();

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
	let checkButton = $state<HTMLElement>();

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
		if (keyboard) void refocus(bankList, at, checkButton ?? answerList?.querySelector('button:last-of-type') ?? null);
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

	$effect(() => {
		if (dockCheck === undefined) return;
		dockCheck(disabled || solved ? null : { label: t('flashcards.card.check'), run: check, disabled: placed.length === 0 });
	});

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
			<Button variant="secondary" disabled={placed.length === 0} onclick={undo}>{t('flashcards.salad.undo')}</Button>
			{#if dockCheck === undefined}
				<Button variant="primary" disabled={!complete} bind:element={checkButton} onclick={check}
					>{t('flashcards.card.check')}</Button
				>
			{/if}
			<Button variant="secondary" onclick={giveUp}>{t('flashcards.card.showAnswer')}</Button>
		</div>
	{/if}
</div>

<p class="feedback" class:bad={wrongChecks > 0 && !solved} role="status" aria-live="polite">
	{#if feedback}{#if solved}<Icon name="check" size="s" />{:else if wrongChecks > 0}<Icon name="close" size="s" />{/if}<span
			>{feedback}</span
		>{/if}
</p>

<style>
	.board {
		display: grid;
		gap: var(--space-4);
		justify-items: center;
		width: 100%;
	}

	.answer,
	.bank {
		box-sizing: border-box;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		width: 100%;
		max-width: 26.25rem;
		margin: 0;
		padding: var(--space-2);
		list-style: none;
	}

	.answer {
		min-height: 3.2rem;
		border-bottom: 1px solid var(--hair);
	}

	.empty {
		align-self: center;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}

	.token {
		min-height: var(--hit);
		min-width: var(--hit);
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--line);
		border-radius: calc(var(--radius) * 0.7);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-family: var(--font-hanzi);
		font-size: 1.125rem;
		cursor: pointer;
	}

	.token:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.token:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	/* A finished sentence stays fully legible: locked, not faded. */
	.token.placed:disabled {
		cursor: default;
		border-style: dashed;
	}

	.token.right,
	.token.placed.right:disabled {
		border-style: solid;
		border-color: var(--good);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
	}

	.feedback {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-height: 1.4rem;
		margin: var(--space-2) 0 0;
		font-weight: var(--weight-strong);
		color: var(--text);
	}

	.feedback.bad {
		color: var(--readable-bad);
	}

	@media (forced-colors: active) {
		.token {
			border-color: ButtonText;
		}
		.token.right,
		.token.placed.right:disabled {
			border: 2px solid Highlight;
		}
	}
</style>
