<script lang="ts">
	import { goto } from '$app/navigation';
	import { getSchemes } from '$lib/api/schemes';
	import type { EntryBase } from '$lib/api/types';
	import { WORD_STATES, classifySchedule } from '$lib/stats/wordStates';
	import { errorMessage } from '$lib/stats/errors';
	import { loadConfig, saveConfig } from '$lib/study/session';
	import { GENERAL_DECK_ID, PartialPushError, loadRawStudyData, pushStudyRows } from '$lib/study/store';
	import { workspaces } from '$lib/workspaces';
	import { flashcardsHref, type FlashcardsRoute } from '../route';
	import { addPlanRows, planAddToDeck } from './addToDeck';
	import { createDecksData } from './decksData.svelte';
	import { loadLevelItems } from './systemDeckItems';
	import { levelDecks, ownedLevelDeckId, type LevelDeck } from './systemDecks';
	import { levelSessionConfig } from './studyStart';

	// A read-only level deck: its items with the learner's state, a level
	// session, and "Add to my decks" (idempotent, see addToDeck.ts). Plugin
	// decks (providers.ts) are wired here when a plugin ships one.
	let { route }: { route: Extract<FlashcardsRoute, { view: 'system-level' | 'system-plugin' }> } = $props();

	const store = createDecksData();
	const workspace = $derived($workspaces.current);
	const workspaceId = $derived(workspace?.id ?? null);
	$effect(() => {
		void store.load(workspaceId);
	});

	let deck = $state.raw<LevelDeck | null | undefined>(undefined); // undefined: still loading
	let items = $state.raw<EntryBase[] | null>(null);
	let loadError = $state('');

	$effect(() => {
		const language = workspace?.language;
		const wanted = route;
		deck = undefined;
		items = null;
		loadError = '';
		if (wanted.view !== 'system-level' || language === undefined) {
			deck = null;
			return;
		}
		getSchemes()
			.then(async (schemes) => {
				const found =
					levelDecks(schemes, language).find((d) => d.packId === wanted.packId && d.level === wanted.level) ?? null;
				deck = found;
				if (found !== null) items = await loadLevelItems(found);
			})
			.catch((err) => {
				loadError = errorMessage(err, 'Could not load this deck.');
			});
	});

	const data = $derived(store.data);
	const existingIds = $derived(new Set([GENERAL_DECK_ID, ...(data?.decks ?? []).map((d) => d.id)]));
	const vocabByEntry = $derived.by(() => {
		const map = new Map<number, string>();
		for (const card of data?.cards ?? []) {
			if (card.kind === 'vocab' && card.deckIds.some((id) => existingIds.has(id))) map.set(card.entryId, card.id);
		}
		return map;
	});
	const ownedCount = $derived((items ?? []).filter((e) => vocabByEntry.has(e.id)).length);

	function stateLabel(entryId: number): string {
		const cardId = vocabByEntry.get(entryId);
		if (cardId === undefined || data === null) return 'Not studied';
		const state = classifySchedule(data.index.get(cardId) ?? null);
		return WORD_STATES.find((s) => s.state === state)?.label ?? 'Not studied';
	}

	const newName = $derived(deck ? `${deck.schemeName} · ${deck.level}` : '');
	let targetChoice = $state('new');
	let busy = $state(false);
	let progress = $state<{ done: number; total: number } | null>(null);
	let result = $state('');
	let error = $state('');
	let reloadable = $state(false);

	function study(): void {
		if (deck === null || deck === undefined) return;
		saveConfig(levelSessionConfig(loadConfig(), deck.schemeId, deck.level));
		void goto('/study/session');
	}

	function words(n: number): string {
		const unit = deck?.unit === 'character' ? 'character' : 'word';
		return `${n} ${unit}${n === 1 ? '' : 's'}`;
	}

	async function add(): Promise<void> {
		if (deck === null || deck === undefined || items === null || workspaceId === null) return;
		busy = true;
		result = '';
		error = '';
		reloadable = false;
		progress = null;
		let deckRows = 0;
		try {
			// Planned from the stored rows right now, so a retry adds only the rest.
			const raw = await loadRawStudyData(workspaceId);
			const isNew = targetChoice === 'new';
			const target = isNew
				? {
						id: ownedLevelDeckId(deck.packId, deck.level),
						name: newName,
						source: { type: 'level' as const, packId: deck.packId, level: deck.level }
					}
				: {
						id: targetChoice,
						name: targetChoice === GENERAL_DECK_ID ? 'General' : (raw.decks.find((d) => d.id === targetChoice)?.name ?? targetChoice)
					};
			const plan = planAddToDeck({
				items: items.map((e) => ({
					entryId: e.id,
					written: e.written,
					...(deck?.unit === 'character' ? { entryKind: 'character' as const } : {})
				})),
				target,
				existingDeck: raw.decks.find((d) => d.id === target.id) ?? null,
				rawCards: raw.cards,
				now: new Date()
			});
			const rows = addPlanRows(plan);
			if (rows.length === 0) {
				result = `Nothing new to add to ${target.name}`;
				return;
			}
			deckRows = plan.deck === null ? 0 : 1;
			const total = plan.writes.length;
			progress = { done: 0, total };
			await pushStudyRows(workspaceId, rows, {
				onProgress: (done) => (progress = { done: Math.max(0, done - deckRows), total })
			});
			result = `Added ${words(plan.created + plan.joined)} to ${target.name}`;
		} catch (err) {
			if (err instanceof PartialPushError) {
				reloadable = err.skipped > 0;
				error =
					err.skipped > 0
						? err.message
						: `Added ${Math.max(0, err.done - deckRows)}; try again to add the rest`;
			} else {
				error = errorMessage(err, 'Could not add the words.');
			}
		} finally {
			busy = false;
			progress = null;
			void store.load(workspaceId, true);
		}
	}

	function reload(): void {
		error = '';
		reloadable = false;
		void store.load(workspaceId, true);
	}
</script>

{#if loadError}
	<p role="alert">{loadError}</p>
{:else if deck === undefined || store.status === 'loading'}
	<p role="status">Loading deck…</p>
{:else if deck === null}
	<p role="status">Deck not found.</p>
	<a href={flashcardsHref({ view: 'list' })}>Back to decks</a>
{:else}
	<p><a href={flashcardsHref({ view: 'list' })}>‹ Decks</a></p>
	<h1>{newName}</h1>
	<p class="hint">A read-only {deck.unit === 'character' ? 'character' : 'word'} list from an installed level pack.</p>
	{#if items === null}
		<p role="status">Loading items…</p>
	{:else}
		<p>{ownedCount} of {items.length} in your decks</p>
		<div class="actions">
			<button type="button" class="primary" onclick={study}>Study this level</button>
			<label>
				Add to
				<select bind:value={targetChoice} disabled={busy}>
					<option value="new">New deck: {newName}</option>
					<option value={GENERAL_DECK_ID}>General</option>
					{#each data?.decks ?? [] as d (d.id)}
						<option value={d.id}>{d.name}</option>
					{/each}
				</select>
			</label>
			<button type="button" disabled={busy} onclick={add}>Add to my decks</button>
		</div>
		{#if progress !== null}
			<p role="status" aria-label="Adding">Adding {progress.done} of {progress.total}…</p>
		{/if}
		{#if result}
			<p role="status">{result}</p>
		{/if}
		{#if error}
			<p class="error" role="alert">{error}</p>
			{#if reloadable}
				<button type="button" onclick={reload}>Reload</button>
			{:else}
				<button type="button" disabled={busy} onclick={add}>Try again</button>
			{/if}
		{/if}
		<ul class="items">
			{#each items as item (item.id)}
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
		align-items: end;
		margin: 0.75rem 0;
	}

	label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.85rem;
	}

	button {
		min-height: 44px;
	}

	.primary {
		padding: 0 1rem;
		border: 1px solid #0b6bcb;
		border-radius: 999px;
		background: #0b6bcb;
		color: #fff;
		font-weight: 600;
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
