<script lang="ts">
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { loadConfig, saveConfig } from '$lib/study/session';
	import { createDeck } from '$lib/study/store';
	import { workspaces } from '$lib/workspaces';
	import { summarizeDecks } from './deckSummaries';
	import { progressShares, progressSummary } from './deckStats';
	import { createDecksData } from './decksData.svelte';
	import DeckStatsPanel from './DeckStatsPanel.svelte';
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
		creating = true;
		formError = '';
		try {
			await createDeck(name);
			newName = '';
			await store.load(workspaceId, true);
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
	<button type="button" onclick={() => void store.load(workspaceId, true)}>{t('flashcards.deck.tryAgain')}</button>
{:else if summary !== null}
	<DeckStatsPanel numbers={summary.overall} />

	<h2>{t('flashcards.list.yourDecks')}</h2>
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
					<button
						type="button"
						class="primary"
						aria-label={t('flashcards.list.studyNamed', { name: deck.name })}
						onclick={() => study(deck.id, deck.kinds)}>{t('flashcards.deck.study')}</button
					>
					<a
						href={flashcardsHref({ view: 'settings', deckId: deck.id })}
						aria-label={t('flashcards.list.settingsNamed', { name: deck.name })}>{t('flashcards.deck.settings')}</a
					>
				</div>
			</li>
		{/each}
	</ul>

	<form class="new" onsubmit={create}>
		<label>
			{t('flashcards.list.newName')}
			<input bind:value={newName} maxlength="80" autocomplete="off" />
		</label>
		<button type="submit" disabled={creating}>{t('flashcards.list.create')}</button>
		{#if formError}
			<p class="error" role="alert">{formError}</p>
		{/if}
	</form>

	<StarterDecks language={$workspaces.current?.language ?? ''} {ownedEntryIds} />
	<SystemDecks language={$workspaces.current?.language ?? ''} {ownedEntryIds} />
{/if}

<style>
	.decks {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	li {
		padding: 0.75rem 1rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 0.5rem;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}

	.name {
		font-weight: 600;
		font-size: 1.05rem;
	}

	.meta,
	.counts {
		font-size: 0.9rem;
		color: var(--readable-muted);
	}

	.counts {
		display: flex;
		gap: 1rem;
		margin-top: 0.25rem;
	}

	.bar {
		display: flex;
		height: 0.5rem;
		margin-top: 0.5rem;
		border-radius: 999px;
		overflow: hidden;
		background: color-mix(in srgb, currentColor 14%, transparent);
	}

	.mastered {
		background: var(--good);
	}

	.studied {
		background: var(--accent);
	}

	.note {
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}

	.actions {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-top: 0.6rem;
	}

	button,
	.actions a {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
	}

	.primary {
		padding: 0 1rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}

	.new {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: end;
		margin: 1rem 0;
	}

	.new label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.9rem;
	}

	.error {
		flex-basis: 100%;
		margin: 0;
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		color: var(--readable-muted);
	}
</style>
