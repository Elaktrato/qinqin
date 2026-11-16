<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Component } from 'svelte';
	import { tick, untrack } from 'svelte';
	import DeckCardTypes from '$lib/study/DeckCardTypes.svelte';
	import { GENERAL_DECK_ID, deleteDeck, renameDeck, saveDeckNewOrder } from '$lib/study/store';
	import { getFrequencyPacks } from '$lib/api/frequency';
	import { getSchemes } from '$lib/api/schemes';
	import type { FrequencyPack, Scheme } from '$lib/api/types';
	import { decodeOrder, deckOrderChoices, encodeOrder } from '$lib/study/newOrderView';
	import { workspaces } from '$lib/workspaces';
	import { flashcardsHref } from '../route';
	import { deleteDeckText } from './deleteText';
	import { createDecksData } from './decksData.svelte';
	import { deckLimitsEditor, type DeckLimitsEditorProps } from './DeckLimitsSlot';

	// `limitsEditor` is 4b's per-deck limits control (DeckLimitsSlot.ts); a test passes a stub.
	let {
		deckId,
		limitsEditor = deckLimitsEditor
	}: { deckId: string; limitsEditor?: Component<DeckLimitsEditorProps> | null } = $props();

	const store = createDecksData();
	const workspaceId = $derived($workspaces.current?.id ?? null);
	$effect(() => {
		void store.load(workspaceId);
	});

	const data = $derived(store.data);
	const isGeneral = $derived(deckId === GENERAL_DECK_ID);
	const deck = $derived(
		data === null
			? null
			: isGeneral
				? { id: GENERAL_DECK_ID, name: 'General', createdAt: '' }
				: (data.decks.find((d) => d.id === deckId) ?? null)
	);

	let name = $state('');
	let nameSeed = '';
	// Start the field from the stored name once per deck; later reloads keep what is typed.
	$effect(() => {
		const stored = deck?.name ?? '';
		if (untrack(() => nameSeed) !== `${deckId}:${stored}`) {
			nameSeed = `${deckId}:${stored}`;
			name = stored;
		}
	});

	// The order of new cards (#75): offered from the installed packs and schemes.
	let packs = $state.raw<FrequencyPack[]>([]);
	let schemes = $state.raw<Scheme[]>([]);
	$effect(() => {
		getFrequencyPacks()
			.then((list) => (packs = Array.isArray(list) ? list : []))
			.catch(() => (packs = []));
		getSchemes()
			.then((list) => (schemes = Array.isArray(list) ? list : []))
			.catch(() => (schemes = []));
	});
	const language = $derived($workspaces.current?.language ?? '');
	const orderView = $derived(deckOrderChoices({ language, packs, schemes }));
	const storedOrder = $derived(encodeOrder(data?.deckSettings[deckId]?.newOrder ?? { by: 'added' }));
	// A stored order this server cannot offer (pack removed) shows as added.
	const orderValue = $derived(
		orderView.choices.some((choice) => choice.value === storedOrder) ? storedOrder : 'added'
	);

	async function saveOrder(value: string): Promise<void> {
		message = '';
		error = '';
		const order = decodeOrder(value);
		busy = true;
		try {
			await saveDeckNewOrder(deckId, order === 'deck' ? { by: 'added' } : order);
			message = 'Saved.';
			await store.load(workspaceId, true);
		} catch (err) {
			error = err instanceof Error && err.message ? err.message : 'Could not save the order.';
		} finally {
			busy = false;
		}
	}

	let message = $state('');
	let error = $state('');
	let busy = $state(false);
	let confirming = $state(false);
	let root: HTMLElement | undefined = $state();

	async function rename(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		message = '';
		error = '';
		const next = name.trim();
		if (next === '') {
			error = 'Give the deck a name.';
			return;
		}
		busy = true;
		try {
			await renameDeck(deckId, next);
			message = 'Renamed.';
			await store.load(workspaceId, true);
		} catch (err) {
			error = err instanceof Error && err.message ? err.message : 'Could not rename the deck.';
		} finally {
			busy = false;
		}
	}

	function openConfirm(): void {
		confirming = true;
		void tick().then(() => root?.querySelector<HTMLElement>('.confirm .secondary')?.focus());
	}

	async function remove(): Promise<void> {
		message = '';
		error = '';
		busy = true;
		try {
			await deleteDeck(deckId);
			await goto(flashcardsHref({ view: 'list' }));
		} catch (err) {
			error = err instanceof Error && err.message ? err.message : 'Could not delete the deck.';
			confirming = false;
		} finally {
			busy = false;
		}
	}

	function confirmKey(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.stopPropagation();
			confirming = false;
		}
	}
</script>

<div bind:this={root}>
	{#if store.status === 'loading'}
		<p role="status">Loading deck…</p>
	{:else if store.status === 'no-workspace'}
		<p role="status">Choose a workspace in the header to see your decks.</p>
	{:else if store.status === 'error'}
		<p role="alert">{store.error}</p>
		<button type="button" onclick={() => void store.load(workspaceId, true)}>Try again</button>
	{:else if deck === null || data === null}
		<p role="status">Deck not found.</p>
		<a href={flashcardsHref({ view: 'list' })}>Back to decks</a>
	{:else}
		<p class="back">
			<a href={flashcardsHref({ view: 'deck', deckId })}>‹ {deck.name}</a>
		</p>
		<h1>{isGeneral ? 'General settings' : `${deck.name} settings`}</h1>

		{#if !isGeneral}
			<section>
				<h2>Name</h2>
				<form class="row" onsubmit={rename}>
					<label>
						Deck name
						<input bind:value={name} maxlength="80" autocomplete="off" />
					</label>
					<button type="submit" disabled={busy}>Save name</button>
				</form>
			</section>
		{/if}

		<section>
			<h2>Card types</h2>
			<p class="hint">Reverse and Cloze cards are made while you study the words of this deck.</p>
			<DeckCardTypes
				{deckId}
				deckName={deck.name}
				cardTypes={data.deckSettings[deckId]?.cardTypes ?? []}
				onSaved={() => void store.load(workspaceId, true)}
			/>
		</section>

		<section>
			<h2>New cards</h2>
			<label>
				Order of new cards
				<select
					value={orderValue}
					disabled={busy}
					onchange={(event) => void saveOrder((event.currentTarget as HTMLSelectElement).value)}
				>
					{#each orderView.choices as choice (choice.value)}
						<option value={choice.value}>{choice.label}</option>
					{/each}
				</select>
			</label>
			{#if orderView.hint !== null}
				<p class="hint">{orderView.hint}</p>
			{/if}
		</section>

		{#if limitsEditor !== null}
			{@const Editor = limitsEditor}
			<section>
				<h2>Daily limits</h2>
				<Editor {deckId} deckName={deck.name} />
			</section>
		{/if}

		{#if !isGeneral}
			<section>
				<h2>Delete</h2>
				<button type="button" class="danger" disabled={busy} onclick={openConfirm}>Delete deck</button>
				{#if confirming}
					<div class="confirm" role="alertdialog" aria-label="Confirm delete" tabindex="-1" onkeydown={confirmKey}>
						<p>{deleteDeckText(deck, data.cards, data.decks)}</p>
						<button type="button" class="danger" disabled={busy} onclick={remove}
							>Delete “{deck.name}”</button
						>
						<button type="button" class="secondary" onclick={() => (confirming = false)}>Cancel</button>
					</div>
				{/if}
			</section>
		{/if}

		{#if message}
			<p role="status">{message}</p>
		{/if}
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
	{/if}
</div>

<style>
	section {
		margin: 1.25rem 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: end;
	}

	label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.9rem;
	}

	button,
	select {
		min-height: 44px;
	}

	select {
		max-width: 100%;
		font: inherit;
	}

	.danger {
		color: #c62828;
	}

	.confirm {
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid #c62828;
		border-radius: 0.5rem;
	}

	.error {
		color: #c62828;
		font-weight: 600;
	}

	.hint {
		opacity: 0.8;
		margin: 0.25rem 0;
	}
</style>
