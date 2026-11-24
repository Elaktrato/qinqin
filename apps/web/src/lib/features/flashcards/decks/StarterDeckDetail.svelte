<script lang="ts">
	import { t } from '$lib/i18n';
	import { readingBeside } from '$lib/entry/displayForm';
	import { getFrequencyPacks } from '$lib/api/frequency';
	import type { StarterEntry } from '$lib/api/frequency';
	import { WORD_STATES, classifySchedule } from '$lib/stats/wordStates';
	import { errorText } from '$lib/api/apiErrors';
	import { knownEntries } from '$lib/study/known';
	import { PartialPushError } from '$lib/sync/push';
	import { loadRawStudyData } from '$lib/study/data';
	import { pushStudy } from '$lib/study/commands/write';
	import { GENERAL_DECK_ID } from '$lib/study/types';
	import { workspaces } from '$lib/workspaces';
	import { glossLang, studyLang, wordReadingLang, readingLang } from '$lib/i18n/lang';
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
		duplicateGlosses,
		type StarterDeck
	} from './starterDecks';
	import { Button } from '$lib/ui';

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
				loadError = errorText(err, t('flashcards.system.loadDeckFailed'));
			});
	});

	const data = $derived(store.data);
	const known = $derived(
		data === null ? new Set<number>() : knownEntries(data.cards, (id) => data.index.get(id) ?? null, data.known)
	);
	const view = $derived(starterView(entries ?? [], known));
	const glosses = $derived(duplicateGlosses(view.shown));
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
		if (cardId === undefined || data === null) return t('flashcards.system.notStudied');
		const state = classifySchedule(data.index.get(cardId) ?? null);
		return WORD_STATES.find((s) => s.state === state)?.label ?? t('flashcards.system.notStudied');
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
			// Known words come from a fresh load of the study history: with the page's
			// data missing (a failed load) every known word would be added.
			await store.load(workspaceId, true);
			const fresh = store.data;
			if (store.status !== 'ready' || fresh === null) {
				error = t('flashcards.system.knownFailed');
				return;
			}
			const knownNow = knownEntries(fresh.cards, (id) => fresh.index.get(id) ?? null, fresh.known);
			// Planned from the stored rows right now, so a retry adds only the rest.
			const raw = await loadRawStudyData(workspaceId);
			const named = { ...target, name: raw.decks.find((d) => d.id === target.id)?.name ?? target.name };
			const plan = planAddToDeck({
				items: starterAddItems(entries),
				target: named,
				existingDeck: raw.decks.find((d) => d.id === target.id) ?? null,
				rawCards: raw.cards,
				unreadable: raw.unreadable,
				now: new Date(),
				exclude: knownNow,
				// Joined cards keep their older createdAt, so the copy studies by frequency.
				settings: { newOrder: { by: 'frequency' }, exists: raw.deckSettings?.[target.id] !== undefined }
			});
			const rows = addPlanRows(plan, raw);
			if (plan.writes.length === 0) {
				// A deck or settings row alone (a deleted copy) is still written.
				if (rows.length > 0) await pushStudy(workspaceId, rows);
				result = t('flashcards.system.nothingNew', { name: named.name });
				return;
			}
			headRows = rows.length - plan.writes.length;
			const total = plan.writes.length;
			progress = { done: 0, total };
			await pushStudy(workspaceId, rows, {
				onProgress: (done) => (progress = { done: Math.max(0, done - headRows), total })
			});
			result = starterAddedText(plan);
		} catch (err) {
			error =
				err instanceof PartialPushError && err.skipped === 0
					? t('flashcards.system.addedPartial', { count: Math.max(0, err.done - headRows) })
					: errorText(err, t('flashcards.system.addFailed'));
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
{:else if deck === null || target === null}
	<p role="status">{t('flashcards.deck.notFound')}</p>
	<a href={flashcardsHref({ view: 'list' })}>{t('flashcards.deck.backToDecks')}</a>
{:else}
	<p><a href={flashcardsHref({ view: 'list' })}>{t('flashcards.deck.back')}</a></p>
	<h1>{target.name}</h1>
	<p class="hint">
		<span>{starterCredit(deck)}</span> · <a href="/sources">{t('flashcards.system.dataLicences')}</a>
	</p>
	<p class="hint">{t('flashcards.starter.intro')}</p>
	{#if entries === null}
		<p role="status">{t('flashcards.system.loadingWords')}</p>
	{:else}
		<p>{t('flashcards.system.owned', { owned: ownedCount, total: view.shown.length })}</p>
		{#if view.knownLine !== null}
			<p class="hint">{view.knownLine}</p>
		{/if}
		<div class="actions">
			<Button variant="primary" disabled={busy} onclick={add}>{t('flashcards.system.addToMine')}</Button>
			{#if existingCopy !== null}
				<Button href={flashcardsHref({ view: 'deck', deckId: existingCopy.id })}>{t('flashcards.starter.openCopy')}</Button>
			{/if}
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
			<Button disabled={busy} onclick={add}>{t('flashcards.deck.tryAgain')}</Button>
		{/if}
		<ul class="items">
			{#each view.shown as item (item.id)}
				<li>
					<span class="word" lang={studyLang(workspace?.language)}>{item.written}</span>
					<span class="reading" lang={wordReadingLang(workspace?.language)}>{readingBeside(item.written, item.readings)}</span>
					{#if glosses.has(item.id)}
						<span class="gloss" lang={glossLang(undefined)}>{glosses.get(item.id)}</span>
					{/if}
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
		gap: var(--space-2);
		align-items: center;
		margin-block: var(--space-3);
	}

	.items {
		list-style: none;
		margin: var(--space-3) 0;
		padding: 0;
	}

	.items li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		align-items: baseline;
		padding-block: var(--space-2);
		border-bottom: 1px solid var(--hair);
	}

	.word {
		font-size: var(--font-size-xl);
		font-family: var(--font-hanzi);
	}

	.reading,
	.gloss,
	.state {
		color: var(--readable-muted);
		font-size: var(--font-size-label);
	}

	.gloss {
		color: var(--text);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		color: var(--readable-muted);
	}
</style>
