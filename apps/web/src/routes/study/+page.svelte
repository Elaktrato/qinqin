<script lang="ts">
	import { goto } from '$app/navigation';
	import { ApiError, api } from '$lib/api/client';
	import { workspaces } from '$lib/workspaces';
	import type { StudyEvent } from '$lib/events';
	import { buildQueue } from '$lib/study/scheduler';
	import {
		CARD_TYPES,
		loadConfig,
		saveConfig,
		validateConfig,
		type StudySessionConfig
	} from '$lib/study/session';
	import {
		GENERAL_DECK_ID,
		cardsInDecks,
		createDeck,
		deleteDeck,
		loadStudyData,
		renameDeck
	} from '$lib/study/store';
	import type { Deck, ReviewEvent, ReviewGrade, StudyCard } from '$lib/study/types';

	// Counts only need to distinguish "none" from "some"; the actual
	// session limits are applied by the session page.
	const COUNT_CAP = 999;

	// Restore this tab's setup before the first render: on an SPA the
	// component never runs during SSR, so sessionStorage is available.
	const saved = loadConfig();

	let decks = $state<Deck[]>([]);
	let cards = $state<StudyCard[]>([]);
	let reviews = $state<ReviewEvent[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let noWorkspace = $state(false);

	let selectedDeckIds = $state<string[]>(saved.deckIds);
	let newLimit = $state(saved.newLimit);
	let reviewLimit = $state(saved.reviewLimit);
	let cardTypes = $state<string[]>(saved.cardTypes);

	let deckName = $state('');
	let creating = $state(false);
	let renamingId = $state<string | null>(null);
	let renameName = $state('');
	let deletingId = $state<string | null>(null);
	let deckError = $state('');
	let starting = $state(false);
	let errors = $state<string[]>([]);

	// Guards against a slow load from an earlier workspace overwriting
	// the data of the one now selected.
	let requestSeq = 0;

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	/**
	 * asReview narrows a stored event to a review. The server only
	 * validates id and timestamp, so the grade is checked again by the
	 * scheduler; here it is enough that the payload has a card and a
	 * numeric grade.
	 */
	function asReview(event: StudyEvent, workspaceId: number): ReviewEvent | null {
		if (event.type !== 'review' || event.workspaceId !== workspaceId) return null;
		const payload = event.payload;
		if (typeof payload !== 'object' || payload === null) return null;
		const { cardId, grade } = payload as Record<string, unknown>;
		if (typeof cardId !== 'string' || typeof grade !== 'number') return null;
		return {
			...event,
			type: 'review',
			payload: { cardId, mode: 'vocab', grade: grade as ReviewGrade }
		};
	}

	/**
	 * keepKnownDecks drops decks deleted since the setup was saved (or
	 * belonging to another workspace). General always exists, so an empty
	 * selection falls back to it instead of an invalid setup.
	 */
	function keepKnownDecks(ids: string[], available: readonly Deck[]): string[] {
		const known = new Set([GENERAL_DECK_ID, ...available.map((deck) => deck.id)]);
		const kept = ids.filter((id) => known.has(id));
		return kept.length > 0 ? kept : [GENERAL_DECK_ID];
	}

	async function load(workspaceId: number | null): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		loadError = '';
		noWorkspace = false;

		if (workspaceId === null) {
			decks = [];
			cards = [];
			reviews = [];
			noWorkspace = true;
			loading = false;
			return;
		}

		try {
			const [data, events] = await Promise.all([
				loadStudyData(),
				api<StudyEvent[]>(
					`/api/events?since=1970-01-01T00:00:00Z&workspace=${workspaceId}`
				)
			]);
			if (seq !== requestSeq) return;
			decks = data.decks;
			cards = data.cards;
			reviews = events
				.map((event) => asReview(event, workspaceId))
				.filter((event): event is ReviewEvent => event !== null);
			selectedDeckIds = keepKnownDecks(selectedDeckIds, data.decks);
		} catch (err) {
			if (seq !== requestSeq) return;
			decks = [];
			cards = [];
			reviews = [];
			loadError = message(err, 'Could not load your decks.');
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	// Refetch when the active workspace changes; the header switcher
	// makes that possible without leaving the page.
	$effect(() => {
		const workspaceId = $workspaces.current?.id ?? null;
		void load(workspaceId);
	});

	const allDecks = $derived([
		{ id: GENERAL_DECK_ID, name: 'General', createdAt: '' },
		...[...decks].sort(
			(a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
		)
	]);

	const selectedCards = $derived(cardsInDecks(cards, selectedDeckIds));

	// Due and new are counted separately so the setup shows what a
	// session would actually contain today. Cards reviewed but not due
	// yet belong to neither bucket.
	const counts = $derived.by(() => {
		if (selectedDeckIds.length === 0) return { due: 0, fresh: 0 };
		const now = new Date();
		const due = buildQueue({
			cards,
			reviews,
			deckIds: selectedDeckIds,
			newLimit: 0,
			reviewLimit: COUNT_CAP,
			now
		}).length;
		const fresh = buildQueue({
			cards,
			reviews,
			deckIds: selectedDeckIds,
			newLimit: COUNT_CAP,
			reviewLimit: 0,
			now
		}).length;
		return { due, fresh };
	});

	const guidance = $derived.by(() => {
		if (noWorkspace) return 'Choose a workspace in the header to set up a study session.';
		if (loading) return 'Loading your study data…';
		if (selectedDeckIds.length === 0) return 'Select at least one deck to start.';
		if (selectedCards.length === 0) {
			return 'The selected decks have no cards yet. Open a word from search and add it from its entry page — new cards go to General unless you pick a deck there.';
		}
		if (counts.due + counts.fresh === 0) {
			return 'Nothing is due and no new cards are left in the selected decks.';
		}
		return '';
	});

	function toggleDeck(id: string): void {
		errors = [];
		selectedDeckIds = selectedDeckIds.includes(id)
			? selectedDeckIds.filter((deckId) => deckId !== id)
			: [...selectedDeckIds, id];
	}

	function toggleCardType(id: string): void {
		errors = [];
		cardTypes = cardTypes.includes(id)
			? cardTypes.filter((type) => type !== id)
			: [...cardTypes, id];
	}

	async function addDeck(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const name = deckName.trim();
		if (!name || creating) return;

		creating = true;
		deckError = '';
		try {
			const deck = await createDeck(name);
			decks = [...decks, deck];
			// A deck the user just made is almost certainly one they want
			// to study from, so select it instead of leaving it unticked.
			selectedDeckIds = [...selectedDeckIds, deck.id];
			deckName = '';
		} catch (err) {
			deckError = message(err, 'Could not create the deck.');
		} finally {
			creating = false;
		}
	}

	function beginRename(deck: Deck): void {
		renamingId = deck.id;
		renameName = deck.name;
		deckError = '';
	}

	function cancelRename(): void {
		renamingId = null;
		renameName = '';
	}

	async function submitRename(event: SubmitEvent, id: string): Promise<void> {
		event.preventDefault();
		const name = renameName.trim();
		if (!name) {
			deckError = 'Deck name cannot be empty.';
			return;
		}

		deckError = '';
		try {
			const renamed = await renameDeck(id, name);
			decks = decks.map((deck) => (deck.id === id ? renamed : deck));
			cancelRename();
		} catch (err) {
			deckError = message(err, 'Could not rename the deck.');
		}
	}

	async function removeDeck(deck: Deck): Promise<void> {
		if (deletingId !== null) return;
		if (
			!confirm(
				`Delete "${deck.name}"? Its cards stay in your other decks, or move to General.`
			)
		) {
			return;
		}

		deletingId = deck.id;
		deckError = '';
		try {
			await deleteDeck(deck.id);
			decks = decks.filter((item) => item.id !== deck.id);
			// Mirror the store's reassignment locally so the counts do not
			// keep counting cards of a deck that is gone.
			cards = cards.map((card) => {
				if (!card.deckIds.includes(deck.id)) return card;
				const remaining = card.deckIds.filter((id) => id !== deck.id);
				return {
					...card,
					deckIds: remaining.length === 0 ? [GENERAL_DECK_ID] : remaining
				};
			});
			selectedDeckIds = selectedDeckIds.filter((id) => id !== deck.id);
		} catch (err) {
			deckError = message(err, 'Could not delete the deck.');
		} finally {
			deletingId = null;
		}
	}

	function start(): void {
		const config: StudySessionConfig = {
			deckIds: [...selectedDeckIds],
			newLimit,
			reviewLimit,
			cardTypes: [...cardTypes]
		};
		errors = validateConfig(config);
		if (errors.length > 0) return;

		starting = true;
		saveConfig(config);
		void goto('/study/session');
	}
</script>

<main class="setup">
	<h1>Study</h1>
	<p class="hint">Choose what this session should draw from.</p>

	{#if loadError}
		<p class="error" role="alert">{loadError}</p>
	{:else if noWorkspace}
		<p class="hint" role="status">Choose a workspace in the header to set up a study session.</p>
	{:else if loading}
		<p class="hint" role="status">Loading your study data…</p>
	{:else}
		<section aria-labelledby="decks-heading">
			<h2 id="decks-heading">Decks</h2>

			{#if decks.length === 0}
				<div class="empty">
					<h3>No decks yet</h3>
					<p>
						Your cards start in General. Create a deck below to organise them by topic or
						level.
					</p>
				</div>
			{/if}

			<ul class="decks">
				{#each allDecks as deck (deck.id)}
					<li class="deck">
						{#if renamingId === deck.id}
							<form class="rename" onsubmit={(event) => submitRename(event, deck.id)}>
								<input
									bind:value={renameName}
									aria-label={`New name for ${deck.name}`}
									maxlength="80"
									required
								/>
								<button type="submit">Save</button>
								<button type="button" class="secondary" onclick={cancelRename}>Cancel</button>
							</form>
						{:else}
							<label class="deck-choice">
								<input
									type="checkbox"
									checked={selectedDeckIds.includes(deck.id)}
									onchange={() => toggleDeck(deck.id)}
								/>
								<span class="deck-name">{deck.name}</span>
								{#if deck.id === GENERAL_DECK_ID}
									<span class="tag">default</span>
								{/if}
							</label>

							{#if deck.id !== GENERAL_DECK_ID}
								<div class="deck-actions">
									<button type="button" class="secondary" onclick={() => beginRename(deck)}>
										Rename
									</button>
									<button
										type="button"
										class="danger"
										disabled={deletingId === deck.id}
										onclick={() => removeDeck(deck)}
									>
										{deletingId === deck.id ? 'Deleting…' : 'Delete'}
									</button>
								</div>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>

			<form class="create" onsubmit={addDeck}>
				<label>
					New deck
					<input
						bind:value={deckName}
						placeholder="HSK 2, Travel, …"
						maxlength="80"
						autocomplete="off"
						required
					/>
				</label>
				<button type="submit" disabled={creating}>
					{creating ? 'Creating…' : 'Create deck'}
				</button>
			</form>

			{#if deckError}
				<p class="error" role="alert">{deckError}</p>
			{/if}
		</section>

		<section aria-labelledby="limits-heading">
			<h2 id="limits-heading">Limits</h2>
			<p class="hint">A session stops after these counts, reviews first.</p>

			<div class="limits">
				<label>
					New cards
					<input type="number" min="1" max="999" step="1" bind:value={newLimit} />
				</label>
				<label>
					Reviews
					<input type="number" min="1" max="999" step="1" bind:value={reviewLimit} />
				</label>
			</div>
		</section>

		<section aria-labelledby="types-heading">
			<h2 id="types-heading">Card types</h2>

			<ul class="types">
				{#each CARD_TYPES as type (type.id)}
					<li>
						<label class="inline" class:disabled={!type.available}>
							<input
								type="checkbox"
								checked={cardTypes.includes(type.id)}
								disabled={!type.available}
								onchange={() => toggleCardType(type.id)}
							/>
							{type.label}
							{#if !type.available}
								<span class="tag">soon</span>
							{/if}
						</label>
					</li>
				{/each}
			</ul>
		</section>

		<section class="summary" aria-labelledby="summary-heading">
			<h2 id="summary-heading">This session</h2>
			<p class="stats">
				<strong>{selectedCards.length}</strong>
				{selectedCards.length === 1 ? 'card' : 'cards'} in
				<strong>{selectedDeckIds.length}</strong>
				{selectedDeckIds.length === 1 ? 'deck' : 'decks'} ·
				<strong>{counts.due}</strong>
				due ·
				<strong>{counts.fresh}</strong>
				new
			</p>

			{#if errors.length > 0}
				<ul class="errors" role="alert">
					{#each errors as error (error)}
						<li>{error}</li>
					{/each}
				</ul>
			{/if}

			<button type="button" class="start" disabled={starting || guidance !== ''} onclick={start}>
				{starting ? 'Starting…' : 'Start studying'}
			</button>

			{#if guidance}
				<p class="hint" role="status">{guidance}</p>
			{/if}
		</section>
	{/if}
</main>

<style>
	.setup {
		margin: 0 auto;
		max-width: 48rem;
		padding: 2.5rem 1.5rem;
	}

	.setup section {
		margin-top: 2rem;
	}

	h1,
	h2,
	h3 {
		margin-bottom: 0.5rem;
	}

	.hint {
		opacity: 0.75;
	}

	.empty {
		border: 1px dashed color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 0.4rem;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}

	.empty h3 {
		margin: 0 0 0.35rem;
	}

	.empty p {
		margin: 0;
		opacity: 0.8;
	}

	.decks,
	.types {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.types {
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
	}

	.deck {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		padding: 0.6rem 0.75rem;
	}

	.deck-choice,
	.inline {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.deck-name {
		font-weight: 600;
	}

	.deck-actions {
		display: flex;
		gap: 0.5rem;
	}

	.deck-actions button,
	.rename button {
		padding: 0.3rem 0.6rem;
	}

	.tag {
		font-size: 0.75rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0.02rem 0.45rem;
		opacity: 0.8;
	}

	.rename {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
	}

	.create {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.create label,
	.limits label {
		display: grid;
		gap: 0.35rem;
		font-weight: 600;
	}

	.limits {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.create input,
	.limits input,
	.rename input,
	.setup button {
		font: inherit;
	}

	.create input,
	.limits input,
	.rename input {
		padding: 0.4rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.limits input {
		width: 5rem;
	}

	.setup button {
		padding: 0.45rem 0.85rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}

	.setup button.secondary {
		background: transparent;
		color: inherit;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
	}

	.setup button.danger {
		background: transparent;
		color: #c62828;
		border: 1px solid currentColor;
	}

	.setup button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.stats {
		margin: 0.5rem 0 1rem;
	}

	.errors {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
		color: #c62828;
		font-weight: 600;
	}

	.error {
		margin: 0.5rem 0 0;
		color: #c62828;
		font-weight: 600;
	}
</style>
