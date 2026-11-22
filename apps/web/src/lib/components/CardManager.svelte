<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { studyLang } from '$lib/i18n/lang';
	import { workspaces } from '$lib/workspaces';
	import { createCardActions, type CardActionsState } from '$lib/study/cardActions';
	import {
		deleteCards,
		dropSiblingCards,
		moveCards,
		restoreCards,
		skipKind,
		unskipKind
	} from '$lib/study/store';
	import { rangeIds, toggleId, wordsOfCards } from '$lib/study/cardSelection';
	import type { Deck, StudyCard } from '$lib/study/types';
	import { Button, Select } from '$lib/ui';

	// Lists the words (vocab cards) of the workspace so they can be moved
	// between decks or deleted, one or many at once. Every change can be
	// undone from the toast; `onchanged` tells the page to reload.
	// Only the newest change is undoable: a new one replaces the toast.
	// The writes, the undo slot and its timer live in the shared controller
	// (lib/study/cardActions.ts), which the decks view uses as well.
	let {
		cards,
		decks,
		onchanged
	}: {
		cards: readonly StudyCard[];
		decks: readonly Deck[];
		onchanged: () => void | Promise<void>;
	} = $props();

	let root: HTMLDetailsElement | undefined = $state();
	let filter = $state('all');
	let selected = $state<string[]>([]);
	let target = $state('');
	let confirming = $state(false);
	let anchor = $state<string | null>(null);

	const actions = createCardActions({
		deleteCards,
		moveCards,
		restoreCards,
		dropSiblingCards,
		skipKind,
		unskipKind,
		onchanged: () => onchanged()
	});
	let controller = $state<CardActionsState>({ busy: false, error: '', undo: null });
	const unsubscribe = actions.state.subscribe((next) => (controller = next));
	const busy = $derived(controller.busy);
	const undo = $derived(controller.undo);
	const error = $derived(controller.error);

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

	onDestroy(() => {
		unsubscribe();
		actions.destroy();
	});

	function label(card: StudyCard): string {
		return card.written ?? t('entry.cards.fallbackLabel', { id: card.entryId });
	}

	function decksOf(card: StudyCard): string {
		return card.deckIds.map((id) => deckName.get(id) ?? id).join(', ');
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
		await actions.remove(ids);
		selected = selected.filter((id) => !ids.includes(id));
		await focusRow(Number.isFinite(index) ? index : 0);
	}

	async function move(): Promise<void> {
		if (target === '' || chosen.length === 0) return;
		const ids = [...chosen];
		await actions.move(ids, target, deckName.get(target) ?? target);
		selected = [];
	}

	function undoLast(): Promise<void> {
		return actions.undo();
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
	<summary>{t('entry.cards.title', { count: words.length })}</summary>

	{#if words.length === 0}
		<p class="hint">{t('entry.cards.none')}</p>
	{:else}
		<div class="bar">
			<div class="filter">
				<Select
					label={t('entry.cards.show')}
					bind:value={filter}
					options={[
						{ value: 'all', label: t('entry.cards.allDecks') },
						...decks.map((deck) => ({ value: deck.id, label: deck.name }))
					]}
				/>
			</div>
			<label class="all">
				<input type="checkbox" checked={allChosen} onchange={toggleAll} />
				{t('entry.cards.selectAll', { count: visible.length })}
			</label>
		</div>

		<p class="hint">{t('entry.cards.hint')}</p>

		<div class="bar actions" role="group" aria-label={t('entry.cards.selected')}>
			<span>{t('entry.cards.selectedCount', { count: chosen.length })}</span>
			<div class="filter">
				<Select
					label={t('entry.cards.moveTo')}
					bind:value={target}
					disabled={chosen.length === 0 || busy}
					options={[
						{ value: '', label: t('entry.cards.chooseDeck') },
						...decks.map((deck) => ({ value: deck.id, label: deck.name }))
					]}
				/>
			</div>
			<Button disabled={chosen.length === 0 || target === '' || busy} onclick={move}>
				{t('entry.cards.move')}
			</Button>
			<Button
				tone="danger"
				disabled={chosen.length === 0 || busy}
				onclick={() => (chosen.length > 1 ? openConfirm() : remove([...chosen]))}
			>
				{t('common.action.delete')}
			</Button>
		</div>

		{#if confirming && chosen.length > 1}
			<div
				class="confirm"
				role="alertdialog"
				aria-label={t('entry.cards.confirmDelete')}
				tabindex="-1"
				onkeydown={confirmKey}
			>
				<p>{t('entry.cards.confirmText', { count: chosen.length })}</p>
				<Button tone="danger" variant="primary" onclick={() => remove([...chosen])}>
					{t('entry.cards.deleteCount', { count: chosen.length })}
				</Button>
				<Button onclick={() => (confirming = false)}>{t('common.action.cancel')}</Button>
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
						<span class="word" lang={studyLang($workspaces.current?.language)}>{label(card)}</span>
						<span class="decks">{decksOf(card)}</span>
					</label>
					<Button
						tone="danger"
						aria-label={t('entry.cards.deleteOne', { word: label(card) })}
						disabled={busy}
						onclick={() => remove([card.id])}
					>
						{t('common.action.delete')}
					</Button>
				</li>
			{/each}
			{#if visible.length === 0}
				<li class="hint">{t('entry.cards.noneInDeck')}</li>
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
			onmouseenter={() => actions.pauseTimer()}
			onmouseleave={() => actions.resumeTimer()}
			onfocusin={() => actions.pauseTimer()}
			onfocusout={() => actions.resumeTimer()}
		>
			<span>{undo.text}</span>
			<Button disabled={busy} onclick={undoLast}>{t('common.action.undo')}</Button>
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

	.filter {
		min-width: 12rem;
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
		border-color: var(--accent);
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
		color: var(--readable-muted);
	}

	.confirm {
		border: 1px solid var(--bad);
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

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.toast-region {
		position: fixed;
		inset: auto 0 calc(1rem + max(var(--bottom-bar-space, 0px), env(safe-area-inset-bottom, 0px))) 0;
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
		background: var(--panel);
		color: var(--text);
		border: 1px solid var(--hair);
		border-radius: 0.5rem;
		padding: 0.6rem 1rem;
		box-shadow: var(--shadow-float);
	}
</style>
