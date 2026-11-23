<script lang="ts">
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { loadConfig, saveConfig } from '$lib/study/session';
	import { createDeck } from '$lib/study/store';
	import { knownEntries } from '$lib/study/known';
	import { workspaces } from '$lib/workspaces';
	import { summarizeDecks } from './deckSummaries';
	import { progressShares, progressSummary } from './deckStats';
	import { createDecksData } from './decksData.svelte';
	import DeckStatsPanel from './DeckStatsPanel.svelte';
	import { Button, Field, Section } from '$lib/ui';
	import SystemDecks from './SystemDecks.svelte';
	import StarterDecks from './StarterDecks.svelte';
	import { deckSessionConfig, sessionKinds } from './studyStart';
	import { onContextStale } from '$lib/study/currentContext';
	import { deckLeftText } from '$lib/study/limitsText';
	import { limitsLeftToday } from './DeckLimitsSlot';
	import { flashcardsHref } from '../route';

	const store = createDecksData();
	const workspaceId = $derived($workspaces.current?.id ?? null);

	$effect(() => {
		void store.load(workspaceId);
	});
	// A new learner day (or zone) changes what is due and on vacation.
	$effect(() => onContextStale(() => void store.load(workspaceId)));

	const summary = $derived.by(() => {
		const data = store.data;
		if (data === null) return null;
		return summarizeDecks({
			...data,
			w: data.weights,
			kindsFor: (ids) => sessionKinds(data.workspaceId, ids, data.deckSettings)
		});
	});

	// Words that already have a card in one of the learner's decks.
	const ownedEntryIds = $derived.by(() => {
		const data = store.data;
		if (data === null) return new Set<number>();
		const ids = new Set(['general', ...data.decks.map((d) => d.id)]);
		return new Set(
			data.cards
				.filter((card) => card.kind === 'vocab' && card.deckIds.some((id) => ids.has(id)))
				.map((card) => card.entryId)
		);
	});

	const deckIds = $derived(new Set((store.data?.decks ?? []).map((deck) => deck.id)));
	const knownIds = $derived.by(() => {
		const data = store.data;
		if (data === null) return new Set<number>();
		return knownEntries(data.cards, (id) => data.index.get(id) ?? null, data.known ?? []);
	});
	const reload = () => void store.load(workspaceId, true);

	let newName = $state('');
	let creating = $state(false);
	let formError = $state('');

	async function create(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const name = newName.trim();
		if (name === '') {
			formError = t('flashcards.list.nameMissing');
			return;
		}
		// The workspace whose decks are listed, captured at the click (#174).
		const ws = workspaceId;
		if (ws === null) return;
		creating = true;
		formError = '';
		try {
			await createDeck(ws, name);
			newName = '';
			// Reload the workspace written; after a switch the view already loads the new one.
			if (workspaceId === ws) await store.load(ws, true);
		} catch (err) {
			formError = err instanceof Error && err.message ? err.message : t('flashcards.list.createFailed');
		} finally {
			creating = false;
		}
	}

	function study(deckId: string, kinds: readonly string[]): void {
		saveConfig(deckSessionConfig(loadConfig(), deckId, kinds));
		void goto('/study/session');
	}

</script>

<h1>{t('flashcards.list.title')}</h1>

{#if store.status === 'loading'}
	<p role="status">{t('flashcards.list.loading')}</p>
{:else if store.status === 'no-workspace'}
	<p role="status">{t('flashcards.deck.noWorkspace')}</p>
{:else if store.status === 'error'}
	<p role="alert">{store.error}</p>
	<Button onclick={() => void store.load(workspaceId, true)}>{t('flashcards.deck.tryAgain')}</Button>
{:else if summary !== null}
	<DeckStatsPanel numbers={summary.overall} />

	<Section title={t('flashcards.list.yourDecks')}>
	<div class="study-all">
		<Button href="/study" variant="primary">{t('flashcards.deck.study')}</Button>
	</div>
	{#if summary.decks.length === 0}
		<p class="hint">{t('flashcards.list.empty')}</p>
	{/if}
	<ul class="decks">
		{#each summary.decks as deck (deck.id)}
			{@const shares = progressShares(deck.numbers)}
			<li>
				<div class="head">
					<a class="name" href={flashcardsHref({ view: 'deck', deckId: deck.id })}>{deck.name}</a>
					<span class="meta">
						{t('flashcards.list.meta', {
							words: t('flashcards.deck.words', { count: deck.numbers.words }),
							cards: t('flashcards.deck.cards', { count: deck.numbers.cards })
						})}
					</span>
				</div>
				<div class="counts">
					{#if store.data?.ctx.vacationToday}
						<span>{t('flashcards.list.onVacation')}</span>
					{:else}
						<span>{t('flashcards.list.due', { count: deck.numbers.due })}</span>
						<span>{t('flashcards.list.new', { count: deck.numbers.fresh })}</span>
						{#if store.data !== null && limitsLeftToday !== null}
							{@const left = deckLeftText(limitsLeftToday(deck.id, store.data, deck.kinds))}
							{#if left !== null}<span class="left">{left}</span>{/if}
						{/if}
					{/if}
				</div>
				<div class="bar" role="img" aria-label={progressSummary(deck.numbers)}>
					<span class="mastered" style:width={`${shares.mastered}%`}></span>
					<span class="studied" style:width={`${shares.studied}%`}></span>
				</div>
				{#if deck.extras}
					<p class="note">{t('flashcards.list.extras')}</p>
				{/if}
				<div class="actions">
					<Button
						aria-label={t('flashcards.list.studyNamed', { name: deck.name })}
						onclick={() => study(deck.id, deck.kinds)}>{t('flashcards.deck.study')}</Button
					>
					<Button
						href={flashcardsHref({ view: 'settings', deckId: deck.id })}
						aria-label={t('flashcards.list.settingsNamed', { name: deck.name })}>{t('flashcards.deck.settings')}</Button
					>
				</div>
			</li>
		{/each}
	</ul>

	<form class="new" onsubmit={create}>
		<Field label={t('flashcards.list.newName')} bind:value={newName} maxlength={80} autocomplete="off" />
		<Button type="submit" disabled={creating}>{t('flashcards.list.create')}</Button>
		{#if formError}
			<p class="error" role="alert">{formError}</p>
		{/if}
	</form>
	</Section>

	<StarterDecks
		language={$workspaces.current?.language ?? ''}
		{ownedEntryIds}
		{workspaceId}
		{deckIds}
		{knownIds}
		onchanged={reload}
	/>
	<SystemDecks
		language={$workspaces.current?.language ?? ''}
		{ownedEntryIds}
		{workspaceId}
		{deckIds}
		onchanged={reload}
	/>
{/if}

<style>
	.decks {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.decks li {
		padding-block: var(--space-3);
	}

	.decks li + li {
		border-top: 1px solid var(--hair);
	}

	.study-all {
		margin-bottom: var(--space-3);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		align-items: baseline;
	}

	.name {
		font-weight: var(--weight-strong);
		font-size: var(--font-size-l);
	}

	.meta,
	.counts {
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.counts {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-1);
	}

	.bar {
		display: flex;
		height: 0.35rem;
		margin-top: var(--space-2);
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--raised);
	}

	.mastered {
		background: var(--good);
	}

	.studied {
		background: var(--accent);
	}

	.note {
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin-top: var(--space-2);
	}

	.new {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: end;
		margin-block: var(--space-4);
		max-width: 28rem;
	}

	.new :global(.field) {
		flex: 1 1 14rem;
	}

	.error {
		flex-basis: 100%;
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		color: var(--readable-muted);
	}
</style>
