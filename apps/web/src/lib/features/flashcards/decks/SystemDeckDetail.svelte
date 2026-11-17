<script lang="ts">
	import { t } from '$lib/i18n';
	import { readingBeside } from '$lib/entry/displayForm';
	import { goto } from '$app/navigation';
	import { getSchemes } from '$lib/api/schemes';
	import type { EntryBase } from '$lib/api/types';
	import { WORD_STATES, classifySchedule } from '$lib/stats/wordStates';
	import { errorMessage } from '$lib/stats/errors';
	import { loadConfig, saveConfig } from '$lib/study/session';
	import { GENERAL_DECK_ID, PartialPushError, loadRawStudyData, pushStudy } from '$lib/study/store';
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
				loadError = errorMessage(err, t('flashcards.system.loadDeckFailed'));
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
		if (cardId === undefined || data === null) return t('flashcards.system.notStudied');
		const state = classifySchedule(data.index.get(cardId) ?? null);
		return WORD_STATES.find((s) => s.state === state)?.label ?? t('flashcards.system.notStudied');
	}

	const newName = $derived(deck ? `${deck.schemeName} · ${deck.level}` : '');
	const ownedId = $derived(deck ? ownedLevelDeckId(deck.packId, deck.level) : '');
	// The owned copy of this level, if there already is one (it may have been renamed).
	const existingCopy = $derived(data?.decks.find((d) => d.id === ownedId) ?? null);
	let targetChoice = $state('new');
	let busy = $state(false);
	let progress = $state<{ done: number; total: number } | null>(null);
	let result = $state('');
	let error = $state('');
	// A push the server partly skipped may be retried once from a fresh pull; the same
	// skip again means a newer row is out of reach, and a third try cannot help.
	let retryable = $state(true);
	let skippedBefore = false;

	function study(): void {
		if (deck === null || deck === undefined) return;
		saveConfig(levelSessionConfig(loadConfig(), deck.schemeId, deck.level));
		void goto('/study/session');
	}

	function words(n: number): string {
		return deck?.unit === 'character'
			? t('flashcards.system.characters', { count: n })
			: t('flashcards.system.words', { count: n });
	}

	async function add(): Promise<void> {
		if (deck === null || deck === undefined || items === null || workspaceId === null) return;
		busy = true;
		result = '';
		error = '';
		retryable = true;
		const retrying = skippedBefore;
		progress = null;
		let deckRows = 0;
		try {
			// Planned from the stored rows right now, so a retry adds only the rest.
			const raw = await loadRawStudyData(workspaceId);
			const id = ownedLevelDeckId(deck.packId, deck.level);
			let target: { id: string; name: string; source?: { type: 'level'; packId: string; level: string } };
			if (targetChoice === 'new') {
				// An existing copy keeps the name the learner gave it.
				target = {
					id,
					name: raw.decks.find((d) => d.id === id)?.name ?? newName,
					source: { type: 'level', packId: deck.packId, level: deck.level }
				};
			} else if (targetChoice === GENERAL_DECK_ID) {
				target = { id: GENERAL_DECK_ID, name: t('flashcards.deck.general') };
			} else {
				const chosen = raw.decks.find((d) => d.id === targetChoice);
				if (chosen === undefined) {
					// Another tab deleted it: never write a deck row named only by an id.
					error = t('flashcards.system.targetRemoved');
					targetChoice = 'new';
					retryable = false;
					return;
				}
				target = { id: chosen.id, name: chosen.name };
			}
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
			const rows = addPlanRows(plan, raw);
			if (rows.length === 0) {
				result = t('flashcards.system.nothingNew', { name: target.name });
				return;
			}
			deckRows = plan.deck === null ? 0 : 1;
			const total = plan.writes.length;
			progress = { done: 0, total };
			await pushStudy(workspaceId, rows, {
				onProgress: (done) => (progress = { done: Math.max(0, done - deckRows), total })
			});
			result = t('flashcards.system.added', { items: words(plan.created + plan.joined), name: target.name });
			skippedBefore = false;
		} catch (err) {
			if (err instanceof PartialPushError) {
				if (err.skipped > 0) {
					skippedBefore = true;
					retryable = !retrying;
					error = retrying
						? t('flashcards.system.serverNewer', { count: err.skipped })
						: err.message;
				} else {
					skippedBefore = false;
					error = t('flashcards.system.addedPartial', { count: Math.max(0, err.done - deckRows) });
				}
			} else {
				skippedBefore = false;
				error = errorMessage(err, t('flashcards.system.addFailed'));
			}
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
	<p role="status">{t('flashcards.deck.loading')}</p>
{:else if deck === null}
	<p role="status">{t('flashcards.deck.notFound')}</p>
	<a href={flashcardsHref({ view: 'list' })}>{t('flashcards.deck.backToDecks')}</a>
{:else}
	<p><a href={flashcardsHref({ view: 'list' })}>{t('flashcards.deck.back')}</a></p>
	<h1>{newName}</h1>
	<p class="hint">
		{deck.unit === 'character' ? t('flashcards.system.introCharacters') : t('flashcards.system.introWords')}
	</p>
	{#if items === null}
		<p role="status">{t('flashcards.system.loadingItems')}</p>
	{:else}
		<p>{t('flashcards.system.owned', { owned: ownedCount, total: items.length })}</p>
		<div class="actions">
			<button type="button" class="primary" onclick={study}>{t('flashcards.system.studyLevel')}</button>
			<label>
				{t('flashcards.system.addTo')}
				<select bind:value={targetChoice} disabled={busy}>
					<option value="new"
						>{existingCopy === null
							? t('flashcards.system.newDeck', { name: newName })
							: t('flashcards.system.existingCopy', { name: existingCopy.name })}</option
					>
					<option value={GENERAL_DECK_ID}>{t('flashcards.deck.general')}</option>
					{#each data?.decks ?? [] as d (d.id)}
						<option value={d.id}>{d.name}</option>
					{/each}
				</select>
			</label>
			<button type="button" disabled={busy} onclick={add}>{t('flashcards.system.addToMine')}</button>
		</div>
		{#if progress !== null}
			<p role="status" aria-label={t('flashcards.system.adding')}>
				{t('flashcards.system.addingProgress', { done: progress.done, total: progress.total })}
			</p>
		{/if}
		{#if result}
			<p role="status">{result}</p>
		{/if}
		{#if error}
			<p class="error" role="alert">{error}</p>
			{#if retryable}
				<button type="button" disabled={busy} onclick={add}>{t('flashcards.deck.tryAgain')}</button>
			{/if}
		{/if}
		<ul class="items">
			{#each items as item (item.id)}
				<li>
					<span class="word">{item.written}</span>
					<span class="reading">{readingBeside(item.written, item.readings)}</span>
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
