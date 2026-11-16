<script lang="ts">
	import { getFrequencyPacks } from '$lib/api/frequency';
	import type { StarterEntry } from '$lib/api/frequency';
	import { WORD_STATES, classifySchedule } from '$lib/stats/wordStates';
	import { errorMessage } from '$lib/stats/errors';
	import { knownEntries } from '$lib/study/known';
	import { GENERAL_DECK_ID, PartialPushError, loadRawStudyData, pushStudyRows } from '$lib/study/store';
	import { workspaces } from '$lib/workspaces';
	import { flashcardsHref, type FlashcardsRoute } from '../route';
	import { addPlanRows, planAddToDeck } from './addToDeck';
	import { createDecksData } from './decksData.svelte';
	import {
		loadStarterEntries,
		starterAddItems,
		starterAddedText,
		starterCredit,
		starterDecks,
		starterTarget,
		starterView,
		type StarterDeck
	} from './starterDecks';

	// A starter deck (#75): the pack's top words as the server resolves them,
	// with the learner's state; known words are skipped and never added. It
	// has no session of its own: add it, then study the copy like any deck.
	let { route }: { route: Extract<FlashcardsRoute, { view: 'system-frequency' }> } = $props();

	const store = createDecksData();
	const workspace = $derived($workspaces.current);
	const workspaceId = $derived(workspace?.id ?? null);
	$effect(() => {
		void store.load(workspaceId);
	});

	let deck = $state.raw<StarterDeck | null | undefined>(undefined); // undefined: still loading
	let entries = $state.raw<StarterEntry[] | null>(null);
	let loadError = $state('');

	$effect(() => {
		const language = workspace?.language;
		const wanted = route;
		deck = undefined;
		entries = null;
		loadError = '';
		if (language === undefined) {
			deck = null;
			return;
		}
		getFrequencyPacks()
			.then(async (packs) => {
				const found =
					starterDecks(Array.isArray(packs) ? packs : [], language).find(
						(d) => d.packId === wanted.packId && d.size === wanted.size
					) ?? null;
				deck = found;
				if (found !== null) entries = await loadStarterEntries(found.packNumId, found.size);
			})
			.catch((err) => {
				loadError = errorMessage(err, 'Could not load this deck.');
			});
	});

	const data = $derived(store.data);
	const known = $derived(
		data === null ? new Set<number>() : knownEntries(data.cards, (id) => data.index.get(id) ?? null)
	);
	const view = $derived(starterView(entries ?? [], known));
	const existingIds = $derived(new Set([GENERAL_DECK_ID, ...(data?.decks ?? []).map((d) => d.id)]));
	const vocabByEntry = $derived.by(() => {
		const map = new Map<number, string>();
		for (const card of data?.cards ?? []) {
			if (card.kind === 'vocab' && card.deckIds.some((id) => existingIds.has(id))) map.set(card.entryId, card.id);
		}
		return map;
	});
	const ownedCount = $derived(view.shown.filter((e) => vocabByEntry.has(e.id)).length);
	const target = $derived(deck ? starterTarget(deck) : null);
	const existingCopy = $derived(target === null ? null : (data?.decks.find((d) => d.id === target.id) ?? null));

	function stateLabel(entryId: number): string {
		const cardId = vocabByEntry.get(entryId);
		if (cardId === undefined || data === null) return 'Not studied';
		const state = classifySchedule(data.index.get(cardId) ?? null);
		return WORD_STATES.find((s) => s.state === state)?.label ?? 'Not studied';
	}

	let busy = $state(false);
	let progress = $state<{ done: number; total: number } | null>(null);
	let result = $state('');
	let error = $state('');

	async function add(): Promise<void> {
		if (deck === null || deck === undefined || target === null || entries === null || workspaceId === null) return;
		busy = true;
		result = '';
		error = '';
		progress = null;
		let headRows = 0;
		try {
			// Planned from the stored rows right now, so a retry adds only the rest.
			const raw = await loadRawStudyData(workspaceId);
			const named = { ...target, name: raw.decks.find((d) => d.id === target.id)?.name ?? target.name };
			const plan = planAddToDeck({
				items: starterAddItems(entries),
				target: named,
				existingDeck: raw.decks.find((d) => d.id === target.id) ?? null,
				rawCards: raw.cards,
				now: new Date(),
				exclude: known,
				// Joined cards keep their older createdAt, so the copy studies by frequency.
				settings: { newOrder: { by: 'frequency' }, exists: raw.deckSettings?.[target.id] !== undefined }
			});
			const rows = addPlanRows(plan, raw.knownAt);
			if (plan.writes.length === 0) {
				// A deck or settings row alone (a deleted copy) is still written.
				if (rows.length > 0) await pushStudyRows(workspaceId, rows);
				result = `Nothing new to add to ${named.name}`;
				return;
			}
			headRows = rows.length - plan.writes.length;
			const total = plan.writes.length;
			progress = { done: 0, total };
			await pushStudyRows(workspaceId, rows, {
				onProgress: (done) => (progress = { done: Math.max(0, done - headRows), total })
			});
			result = starterAddedText(plan);
		} catch (err) {
			error =
				err instanceof PartialPushError && err.skipped === 0
					? `Added ${Math.max(0, err.done - headRows)}; try again to add the rest`
					: errorMessage(err, 'Could not add the words.');
		} finally {
			busy = false;
			progress = null;
			void store.load(workspaceId, true);
		}
	}
</script>

{#if loadError}
	<p role="alert">{loadError}</p>
{:else if deck === undefined || store.status === 'loading'}
	<p role="status">Loading deck…</p>
{:else if deck === null || target === null}
	<p role="status">Deck not found.</p>
	<a href={flashcardsHref({ view: 'list' })}>Back to decks</a>
{:else}
	<p><a href={flashcardsHref({ view: 'list' })}>‹ Decks</a></p>
	<h1>{target.name}</h1>
	<p class="hint">
		<span>{starterCredit(deck)}</span> · <a href="/sources">Data and licences</a>
	</p>
	<p class="hint">The most frequent words of the list, computed on this server. Add it to study it.</p>
	{#if entries === null}
		<p role="status">Loading words…</p>
	{:else}
		<p>{ownedCount} of {view.shown.length} in your decks</p>
		{#if view.knownLine !== null}
			<p class="hint">{view.knownLine}</p>
		{/if}
		<div class="actions">
			<button type="button" disabled={busy} onclick={add}>Add to my decks</button>
			{#if existingCopy !== null}
				<a href={flashcardsHref({ view: 'deck', deckId: existingCopy.id })}>Open my copy</a>
			{/if}
		</div>
		{#if progress !== null}
			<p role="status" aria-label="Adding">Adding {progress.done} of {progress.total}…</p>
		{/if}
		{#if result}
			<p role="status">{result}</p>
		{/if}
		{#if error}
			<p class="error" role="alert">{error}</p>
			<button type="button" disabled={busy} onclick={add}>Try again</button>
		{/if}
		<ul class="items">
			{#each view.shown as item (item.id)}
				<li>
					<span class="word">{item.written}</span>
					<span class="reading">{item.readings[0]?.value ?? ''}</span>
					<span class="state">{stateLabel(item.id)}</span>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin: 0.75rem 0;
	}

	button {
		min-height: 44px;
	}

	.items {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
	}

	.items li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		align-items: baseline;
		padding: 0.3rem 0;
		border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
	}

	.word {
		font-size: 1.1rem;
		font-weight: 600;
	}

	.reading,
	.state,
	.hint {
		opacity: 0.8;
		font-size: 0.9rem;
	}

	.error {
		color: #c62828;
		font-weight: 600;
	}
</style>
