<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import {
		PartialCardsError,
		deleteCards,
		moveCards,
		restoreCards
	} from '$lib/study/store';
	import { rangeIds, toggleId, wordsOfCards } from '$lib/study/cardSelection';
	import type { Deck, StudyCard } from '$lib/study/types';

	// Lists the words (vocab cards) of the workspace so they can be moved
	// between decks or deleted, one or many at once. Every change can be
	// undone from the toast; `onchanged` tells the page to reload.
	// Only the newest change is undoable: a new one replaces the toast.
	let {
		cards,
		decks,
		onchanged
	}: {
		cards: readonly StudyCard[];
		decks: readonly Deck[];
		onchanged: () => void | Promise<void>;
	} = $props();

	const UNDO_MS = 10000;

	interface UndoSlot {
		text: string;
		rows: StudyCard[];
		// A move-undo must not revive a card another tab deleted since.
		onlyLive: boolean;
	}

	let root: HTMLDetailsElement | undefined = $state();
	let filter = $state('all');
	let selected = $state<string[]>([]);
	let target = $state('');
	let pending = $state(0);
	let error = $state('');
	let confirming = $state(false);
	let anchor = $state<string | null>(null);
	let undo = $state<UndoSlot | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | undefined;
	// Writes run one after another, so an old undo can never overlap or
	// follow a newer delete it would resurrect.
	let chain: Promise<unknown> = Promise.resolve();
	const busy = $derived(pending > 0);

	const deckName = $derived(new Map(decks.map((deck) => [deck.id, deck.name])));
	const words = $derived(wordsOfCards(cards));
	const visible = $derived(
		filter === 'all' ? words : words.filter((card) => card.deckIds.includes(filter))
	);
	const visibleIds = $derived(visible.map((card) => card.id));
	// A selection never keeps ids that are gone or filtered out.
	const chosen = $derived(selected.filter((id) => visibleIds.includes(id)));
	const allChosen = $derived(visible.length > 0 && chosen.length === visible.length);

	// The confirmation belongs to the selection it was opened for.
	$effect(() => {
		void chosen.length;
		void filter;
		confirming = false;
	});

	onDestroy(() => clearTimeout(undoTimer));

	function label(card: StudyCard): string {
		return card.written ?? `Entry ${card.entryId}`;
	}

	function decksOf(card: StudyCard): string {
		return card.deckIds.map((id) => deckName.get(id) ?? id).join(', ');
	}

	function startTimer(): void {
		clearTimeout(undoTimer);
		undoTimer = setTimeout(() => {
			// Never expire under a running write or a hovering pointer.
			if (busy) startTimer();
			else undo = null;
		}, UNDO_MS);
	}

	function offerUndo(slot: UndoSlot): void {
		undo = slot;
		startTimer();
	}

	function run(action: () => Promise<void>): Promise<void> {
		const task = chain.then(async () => {
			pending += 1;
			error = '';
			try {
				await action();
			} catch (err) {
				error = err instanceof Error && err.message ? err.message : 'That did not work.';
			} finally {
				// A failed write may still have landed: always show the stored state.
				try {
					await onchanged();
				} finally {
					pending -= 1;
				}
			}
		});
		chain = task.catch(() => undefined);
		return task;
	}

	function pick(card: StudyCard, event: MouseEvent): void {
		const input = event.currentTarget as HTMLInputElement;
		if (event.shiftKey && anchor !== null) {
			const range = rangeIds(visibleIds, anchor, card.id);
			selected = [...new Set([...selected, ...range])];
		} else {
			selected = toggleId(selected, card.id);
		}
		anchor = card.id;
		// State drives the checkbox; the native toggle of a shift-click on
		// an already selected row must not leave it out of step.
		void tick().then(() => (input.checked = chosen.includes(card.id)));
	}

	function toggleAll(): void {
		selected = allChosen ? [] : [...visibleIds];
	}

	async function focusRow(index: number): Promise<void> {
		await tick();
		const inputs = root?.querySelectorAll<HTMLInputElement>('.rows .pick input');
		if (inputs !== undefined && inputs.length > 0) {
			inputs[Math.min(index, inputs.length - 1)].focus();
		} else {
			root?.querySelector<HTMLElement>('summary')?.focus();
		}
	}

	async function remove(ids: string[]): Promise<void> {
		confirming = false;
		const index = Math.min(...ids.map((id) => visibleIds.indexOf(id)).filter((i) => i >= 0));
		await run(async () => {
			let removed: StudyCard[];
			let failure: unknown = null;
			try {
				removed = await deleteCards(ids);
			} catch (err) {
				if (!(err instanceof PartialCardsError)) throw err;
				// Part of it landed: that part stays undoable.
				removed = err.rows;
				failure = err;
			}
			selected = selected.filter((id) => !ids.includes(id));
			if (removed.length > 0) {
				offerUndo({
					text: ids.length === 1 ? 'Card deleted.' : `${ids.length} cards deleted.`,
					rows: removed,
					onlyLive: false
				});
			}
			if (failure !== null) throw failure;
		});
		await focusRow(Number.isFinite(index) ? index : 0);
	}

	async function move(): Promise<void> {
		if (target === '' || chosen.length === 0) return;
		const ids = [...chosen];
		const name = deckName.get(target) ?? target;
		await run(async () => {
			let before: StudyCard[];
			let failure: unknown = null;
			try {
				before = await moveCards(ids, target);
			} catch (err) {
				if (!(err instanceof PartialCardsError)) throw err;
				before = err.rows;
				failure = err;
			}
			selected = [];
			if (before.length > 0) {
				offerUndo({
					text: ids.length === 1 ? `Moved to ${name}.` : `Moved ${ids.length} cards to ${name}.`,
					rows: before,
					onlyLive: true
				});
			}
			if (failure !== null) throw failure;
		});
	}

	async function undoLast(): Promise<void> {
		if (undo === null || busy) return;
		clearTimeout(undoTimer);
		await run(async () => {
			const slot = undo;
			if (slot === null) return;
			try {
				await restoreCards(slot.rows, { onlyLive: slot.onlyLive });
				// Cleared only after it worked, so a failed undo can be retried.
				undo = null;
			} catch (err) {
				if (err instanceof PartialCardsError) undo = { ...slot, rows: err.rows };
				startTimer();
				throw err;
			}
		});
	}

	function rowKey(event: KeyboardEvent, card: StudyCard): void {
		if ((event.key === 'Delete' || event.key === 'Backspace') && !busy) {
			event.preventDefault();
			void remove([card.id]);
		}
	}

	function openConfirm(): void {
		confirming = true;
		void tick().then(() => root?.querySelector<HTMLElement>('.confirm .secondary')?.focus());
	}

	function confirmKey(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.stopPropagation();
			confirming = false;
			root?.querySelector<HTMLElement>('.actions .danger')?.focus();
		}
	}
</script>

<details class="manager" bind:this={root}>
	<summary>Manage cards ({words.length})</summary>

	{#if words.length === 0}
		<p class="hint">No cards yet. Add words from their entry page.</p>
	{:else}
		<div class="bar">
			<label>
				Show
				<select bind:value={filter}>
					<option value="all">All decks</option>
					{#each decks as deck (deck.id)}
						<option value={deck.id}>{deck.name}</option>
					{/each}
				</select>
			</label>
			<label class="all">
				<input type="checkbox" checked={allChosen} onchange={toggleAll} />
				Select all ({visible.length})
			</label>
		</div>

		<p class="hint">
			Deleting a word removes it from every deck, together with its sentence, writing and tone
			cards. Moving a word puts it and those cards in the chosen deck only.
		</p>

		<div class="bar actions" role="group" aria-label="Selected cards">
			<span>{chosen.length} selected</span>
			<label>
				Move to
				<select bind:value={target} disabled={chosen.length === 0 || busy}>
					<option value="">Choose a deck</option>
					{#each decks as deck (deck.id)}
						<option value={deck.id}>{deck.name}</option>
					{/each}
				</select>
			</label>
			<button type="button" disabled={chosen.length === 0 || target === '' || busy} onclick={move}>
				Move
			</button>
			<button
				type="button"
				class="danger"
				disabled={chosen.length === 0 || busy}
				onclick={() => (chosen.length > 1 ? openConfirm() : remove([...chosen]))}
			>
				Delete
			</button>
		</div>

		{#if confirming && chosen.length > 1}
			<div
				class="confirm"
				role="alertdialog"
				aria-label="Confirm delete"
				tabindex="-1"
				onkeydown={confirmKey}
			>
				<p>
					Delete {chosen.length} words from every deck, with their other cards? You can undo
					this right after.
				</p>
				<button type="button" class="danger" onclick={() => remove([...chosen])}>
					Delete {chosen.length} cards
				</button>
				<button type="button" class="secondary" onclick={() => (confirming = false)}>
					Cancel
				</button>
			</div>
		{/if}

		<ul class="rows">
			{#each visible as card (card.id)}
				<li class:picked={chosen.includes(card.id)}>
					<label class="pick">
						<input
							type="checkbox"
							checked={chosen.includes(card.id)}
							onclick={(event) => pick(card, event)}
							onkeydown={(event) => rowKey(event, card)}
						/>
						<span class="word" lang="zh">{label(card)}</span>
						<span class="decks">{decksOf(card)}</span>
					</label>
					<button
						type="button"
						class="danger"
						aria-label={`Delete ${label(card)}`}
						disabled={busy}
						onclick={() => remove([card.id])}
					>
						Delete
					</button>
				</li>
			{/each}
			{#if visible.length === 0}
				<li class="hint">No cards in this deck.</li>
			{/if}
		</ul>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</details>

<div class="toast-region" role="status" aria-live="polite">
	{#if undo}
		<div
			class="toast"
			role="presentation"
			onmouseenter={() => clearTimeout(undoTimer)}
			onmouseleave={startTimer}
			onfocusin={() => clearTimeout(undoTimer)}
			onfocusout={startTimer}
		>
			<span>{undo.text}</span>
			<button type="button" disabled={busy} onclick={undoLast}>Undo</button>
		</div>
	{/if}
</div>

<style>
	.manager {
		margin-top: 1.5rem;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
		padding: 0.5rem 0;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		margin: 0.5rem 0;
	}

	.bar label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.rows {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
		max-height: 24rem;
		overflow-y: auto;
	}

	.rows li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 2.75rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		padding: 0.2rem 0.6rem;
	}

	.rows li.picked {
		border-color: #0b6bcb;
	}

	.pick {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex: 1;
		min-height: 2.75rem;
		cursor: pointer;
	}

	.pick input {
		width: 1.2rem;
		height: 1.2rem;
	}

	.word {
		font-weight: 600;
	}

	.decks,
	.hint {
		font-size: 0.85rem;
		opacity: 0.75;
	}

	.confirm {
		border: 1px solid #b3261e;
		border-radius: 0.4rem;
		padding: 0.6rem 0.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}

	.confirm p {
		margin: 0;
		flex-basis: 100%;
	}

	button {
		min-height: 2.75rem;
		min-width: 2.75rem;
	}

	.error {
		color: #b3261e;
	}

	.toast-region {
		position: fixed;
		inset: auto 0 calc(1rem + var(--bottom-bar-height, 0px)) 0;
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: 50;
	}

	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 1rem;
		background: #222;
		color: #fff;
		border-radius: 0.5rem;
		padding: 0.6rem 1rem;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.3);
	}
</style>
