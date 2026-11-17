<script lang="ts">
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import type { Component } from 'svelte';
	import { tick, untrack } from 'svelte';
	import DeckCardTypes from '$lib/study/DeckCardTypes.svelte';
	import { GENERAL_DECK_ID, deleteDeck, renameDeck, saveDeckNewOrder } from '$lib/study/store';
	import { getFrequencyPacks } from '$lib/api/frequency';
	import { getSchemes } from '$lib/api/schemes';
	import type { FrequencyPack, Scheme } from '$lib/api/types';
	import { decodeOrder, deckOrderControl } from '$lib/study/newOrderView';
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
	// Until both lists are in, the select is disabled on the stored order.
	let packs = $state.raw<FrequencyPack[] | null>(null);
	let schemes = $state.raw<Scheme[] | null>(null);
	let listsFailed = $state(false);
	$effect(() => {
		getFrequencyPacks()
			.then((list) => (packs = Array.isArray(list) ? list : []))
			.catch(() => (listsFailed = true));
		getSchemes()
			.then((list) => (schemes = Array.isArray(list) ? list : []))
			.catch(() => (listsFailed = true));
	});
	const language = $derived($workspaces.current?.language ?? '');
	const orderControl = $derived(
		deckOrderControl({
			stored: data?.deckSettings[deckId]?.newOrder ?? null,
			env: packs === null || schemes === null ? null : { language, packs, schemes },
			failed: listsFailed
		})
	);

	async function saveOrder(value: string): Promise<void> {
		message = '';
		error = '';
		const order = decodeOrder(value);
		busy = true;
		try {
			await saveDeckNewOrder(deckId, order === 'deck' ? { by: 'added' } : order);
			message = t('flashcards.settings.saved');
			await store.load(workspaceId, true);
		} catch (err) {
			error = err instanceof Error && err.message ? err.message : t('flashcards.settings.orderFailed');
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
			error = t('flashcards.list.nameMissing');
			return;
		}
		busy = true;
		try {
			await renameDeck(deckId, next);
			message = t('flashcards.settings.renamed');
			await store.load(workspaceId, true);
		} catch (err) {
			error = err instanceof Error && err.message ? err.message : t('flashcards.settings.renameFailed');
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
			error = err instanceof Error && err.message ? err.message : t('flashcards.settings.deleteFailed');
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
		<p role="status">{t('flashcards.deck.loading')}</p>
	{:else if store.status === 'no-workspace'}
		<p role="status">{t('flashcards.deck.noWorkspace')}</p>
	{:else if store.status === 'error'}
		<p role="alert">{store.error}</p>
		<button type="button" onclick={() => void store.load(workspaceId, true)}>{t('flashcards.deck.tryAgain')}</button>
	{:else if deck === null || data === null}
		<p role="status">{t('flashcards.deck.notFound')}</p>
		<a href={flashcardsHref({ view: 'list' })}>{t('flashcards.deck.backToDecks')}</a>
	{:else}
		<p class="back">
			<a href={flashcardsHref({ view: 'deck', deckId })}>{t('flashcards.settings.back', { name: deck.name })}</a>
		</p>
		<h1>{isGeneral ? t('flashcards.settings.generalTitle') : t('flashcards.settings.title', { name: deck.name })}</h1>

		{#if !isGeneral}
			<section>
				<h2>{t('flashcards.settings.name')}</h2>
				<form class="row" onsubmit={rename}>
					<label>
						{t('flashcards.settings.deckName')}
						<input bind:value={name} maxlength="80" autocomplete="off" />
					</label>
					<button type="submit" disabled={busy}>{t('flashcards.settings.saveName')}</button>
				</form>
			</section>
		{/if}

		<section>
			<h2>{t('flashcards.settings.cardTypes')}</h2>
			<p class="hint">{t('flashcards.settings.cardTypesHint')}</p>
			<DeckCardTypes
				{deckId}
				deckName={deck.name}
				cardTypes={data.deckSettings[deckId]?.cardTypes ?? []}
				onSaved={() => void store.load(workspaceId, true)}
			/>
		</section>

		<section>
			<h2>{t('flashcards.settings.newCards')}</h2>
			<label>
				{t('flashcards.settings.order')}
				<select
					value={orderControl.value}
					disabled={busy || orderControl.disabled}
					onchange={(event) => void saveOrder((event.currentTarget as HTMLSelectElement).value)}
				>
					{#each orderControl.choices as choice (choice.value)}
						<option value={choice.value} disabled={choice.disabled}>{choice.label}</option>
					{/each}
				</select>
			</label>
			{#if orderControl.hint !== null}
				<p class="hint">{orderControl.hint}</p>
			{/if}
		</section>

		{#if limitsEditor !== null}
			{@const Editor = limitsEditor}
			<section>
				<h2>{t('flashcards.settings.dailyLimits')}</h2>
				<Editor {deckId} deckName={deck.name} />
			</section>
		{/if}

		{#if !isGeneral}
			<section>
				<h2>{t('flashcards.settings.delete')}</h2>
				<button type="button" class="danger" disabled={busy} onclick={openConfirm}>{t('flashcards.settings.deleteDeck')}</button>
				{#if confirming}
					<div class="confirm" role="alertdialog" aria-label={t('flashcards.deck.confirmDelete')} tabindex="-1" onkeydown={confirmKey}>
						<p>{deleteDeckText(deck, data.cards, data.decks)}</p>
						<button type="button" class="danger" disabled={busy} onclick={remove}
							>{t('flashcards.settings.deleteNamed', { name: deck.name })}</button
						>
						<button type="button" class="secondary" onclick={() => (confirming = false)}>{t('common.action.cancel')}</button>
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
		color: var(--readable-bad);
	}

	.confirm {
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--bad);
		border-radius: 0.5rem;
	}

	.error {
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		color: var(--readable-muted);
		margin: 0.25rem 0;
	}
</style>
