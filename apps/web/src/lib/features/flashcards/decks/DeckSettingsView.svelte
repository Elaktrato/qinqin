<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import type { Component } from 'svelte';
	import { tick, untrack } from 'svelte';
	import DeckCardTypes from '$lib/study/DeckCardTypes.svelte';
	import { deleteDeck, renameDeck, saveDeckNewOrder } from '$lib/study/commands/decks';
	import { GENERAL_DECK_ID } from '$lib/study/types';
	import { getFrequencyPacks } from '$lib/api/frequency';
	import { getSchemes } from '$lib/api/schemes';
	import type { FrequencyPack, Scheme } from '$lib/api/types';
	import { decodeOrder, deckOrderControl } from '$lib/study/newOrderView';
	import { flashcardsHref } from '../route';
	import { Button, Field, Section, Select } from '$lib/ui';
	import { deleteDeckText } from './deleteText';
	import { createDecksData } from './decksData.svelte';
	import { deckLimitsEditor, type DeckLimitsEditorProps } from './DeckLimitsSlot';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	// `limitsEditor` is 4b's per-deck limits control (DeckLimitsSlot.ts); a test passes a stub.
	let {
		deckId,
		limitsEditor = deckLimitsEditor
	}: { deckId: string; limitsEditor?: Component<DeckLimitsEditorProps> | null } = $props();

	const store = createDecksData(session.study);
	const workspaceId = $derived(session.workspaces.current?.id ?? null);
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
	const language = $derived(session.workspaces.current?.language ?? '');
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
		const ws = data?.workspaceId;
		if (ws === undefined) return;
		busy = true;
		try {
			await saveDeckNewOrder(session.study, ws, deckId, order === 'deck' || order === 'random' ? { by: 'added' } : order);
			message = t('flashcards.settings.saved');
			await store.load(workspaceId, true);
		} catch (err) {
			error = errorText(err, t('flashcards.settings.orderFailed'));
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
		const ws = data?.workspaceId;
		if (ws === undefined) return;
		busy = true;
		try {
			await renameDeck(session.study, ws, deckId, next);
			message = t('flashcards.settings.renamed');
			await store.load(workspaceId, true);
		} catch (err) {
			error = errorText(err, t('flashcards.settings.renameFailed'));
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
		const ws = data?.workspaceId;
		if (ws === undefined) return;
		busy = true;
		try {
			await deleteDeck(session.study, ws, deckId);
			await goto(flashcardsHref({ view: 'list' }));
		} catch (err) {
			error = errorText(err, t('flashcards.settings.deleteFailed'));
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
		<Button onclick={() => void store.load(workspaceId, true)}>{t('flashcards.deck.tryAgain')}</Button>
	{:else if deck === null || data === null}
		<p role="status">{t('flashcards.deck.notFound')}</p>
		<a href={flashcardsHref({ view: 'list' })}>{t('flashcards.deck.backToDecks')}</a>
	{:else}
		<p class="back">
			<a href={flashcardsHref({ view: 'deck', deckId })}>{t('flashcards.settings.back', { name: deck.name })}</a>
		</p>
		<h1>{isGeneral ? t('flashcards.settings.generalTitle') : t('flashcards.settings.title', { name: deck.name })}</h1>

		{#if !isGeneral}
			<Section title={t('flashcards.settings.name')}>
				<form class="row" onsubmit={rename}>
					<Field
						label={t('flashcards.settings.deckName')}
						bind:value={name}
						maxlength={80}
						autocomplete="off"
					/>
					<Button type="submit" variant="primary" disabled={busy}>{t('flashcards.settings.saveName')}</Button>
				</form>
			</Section>
		{/if}

		<Section title={t('flashcards.settings.cardTypes')}>
			<p class="hint">{t('flashcards.settings.cardTypesHint')}</p>
			<DeckCardTypes
				workspaceId={data.workspaceId}
				{deckId}
				deckName={deck.name}
				cardTypes={data.deckSettings[deckId]?.cardTypes ?? []}
				onSaved={() => void store.load(workspaceId, true)}
			/>
		</Section>

		<Section title={t('flashcards.settings.newCards')}>
			<Select
				label={t('flashcards.settings.order')}
				value={orderControl.value}
				disabled={busy || orderControl.disabled}
				onchange={(event) => void saveOrder((event.currentTarget as HTMLSelectElement).value)}
				options={orderControl.choices.map((choice) => ({
					value: choice.value,
					label: choice.label,
					disabled: choice.disabled
				}))}
			/>
			{#if orderControl.hint !== null}
				<p class="hint">{orderControl.hint}</p>
			{/if}
		</Section>

		{#if limitsEditor !== null}
			{@const Editor = limitsEditor}
			<Section title={t('flashcards.settings.dailyLimits')}>
				<Editor {deckId} deckName={deck.name} />
			</Section>
		{/if}

		{#if !isGeneral}
			<Section title={t('flashcards.settings.delete')}>
				<Button tone="danger" disabled={busy} onclick={openConfirm}>{t('flashcards.settings.deleteDeck')}</Button>
				{#if confirming}
					<div class="confirm" role="alertdialog" aria-label={t('flashcards.deck.confirmDelete')} tabindex="-1" onkeydown={confirmKey}>
						<p>{deleteDeckText(deck, data.cards, data.decks)}</p>
						<Button variant="primary" tone="danger" disabled={busy} onclick={remove}
							>{t('flashcards.settings.deleteNamed', { name: deck.name })}</Button
						>
						<Button onclick={() => (confirming = false)}>{t('common.action.cancel')}</Button>
					</div>
				{/if}
			</Section>
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
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: end;
		max-width: 32rem;
	}

	.row :global(.field) {
		flex: 1 1 16rem;
	}

	.confirm {
		margin-top: var(--space-3);
		padding-block: var(--space-3);
		border-top: 1px solid var(--hair);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.confirm p {
		flex-basis: 100%;
		margin: 0;
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		color: var(--readable-muted);
		margin: var(--space-1) 0;
	}
</style>
