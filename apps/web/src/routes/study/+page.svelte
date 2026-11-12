<script lang="ts">
	import { goto } from '$app/navigation';
	import { ApiError, api } from '$lib/api/client';
	import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
	import type { EntryBase, Level, Scheme } from '$lib/api/types';
	import { workspaces } from '$lib/workspaces';
	import type { StudyEvent } from '$lib/events';
	import { buildLevelQueue } from '$lib/study/levelQueue';
	import { buildQueue } from '$lib/study/scheduler';
	import {
		CARD_TYPES,
		loadConfig,
		saveConfig,
		validateConfig,
		type StudySessionConfig,
		type StudySessionMode
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
	let mode = $state<StudySessionMode>(saved.mode);
	let schemeId = $state<number | null>(saved.schemeId);
	let levelName = $state<string | null>(saved.levelName);

	// Schemes are global, so they are filtered by the language of the
	// workspace the setup is running in. `schemesLoaded` separates "not
	// fetched yet" from "none installed for this language", which decides
	// whether a saved selection is kept or cleared.
	let schemes = $state<Scheme[]>([]);
	let workspaceLanguage = $state<string | null>(null);
	let activeWorkspaceId = $state<number | null>(null);
	let schemesLoaded = $state(false);
	let schemeError = $state('');

	let levelEntries = $state<EntryBase[]>([]);
	let levelEntriesLoading = $state(false);
	let levelEntriesError = $state('');
	let levelEntriesSeq = 0;

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

	async function load(workspaceId: number | null, language: string | null): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		loadError = '';
		noWorkspace = false;

		// A pending level load belongs to the previous workspace or
		// selection; its result must not land in the new one.
		levelEntriesSeq += 1;
		levelEntries = [];
		levelEntriesLoading = false;
		levelEntriesError = '';
		schemes = [];
		workspaceLanguage = language;
		activeWorkspaceId = workspaceId;
		schemesLoaded = false;
		schemeError = '';

		if (workspaceId === null) {
			decks = [];
			cards = [];
			reviews = [];
			noWorkspace = true;
			loading = false;
			return;
		}

		// Schemes do not gate the deck setup: the request runs alongside
		// it, and the levels section shows its own loading state.
		void loadSchemes(seq);

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

	async function loadSchemes(seq: number): Promise<void> {
		try {
			const list = await getSchemes();
			if (seq !== requestSeq) return;
			schemes = list;
		} catch (err) {
			if (seq !== requestSeq) return;
			schemes = [];
			schemeError = message(err, 'Could not load level schemes.');
		} finally {
			if (seq === requestSeq) schemesLoaded = true;
		}
	}

	// Refetch when the active workspace changes; the header switcher
	// makes that possible without leaving the page.
	$effect(() => {
		const workspace = $workspaces.current;
		void load(workspace?.id ?? null, workspace?.language ?? null);
	});

	const allDecks = $derived([
		{ id: GENERAL_DECK_ID, name: 'General', createdAt: '' },
		...[...decks].sort(
			(a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
		)
	]);

	const selectedCards = $derived(cardsInDecks(cards, selectedDeckIds));

	// Only schemes in the workspace's language are offered: studying a
	// Japanese ladder in a Chinese workspace would mix entries.
	const schemesForLanguage = $derived(
		schemes.filter((scheme) => scheme.language === workspaceLanguage)
	);

	const selectedScheme = $derived(
		schemesForLanguage.find((scheme) => scheme.id === schemeId) ?? null
	);

	const schemeLevels = $derived.by((): Level[] => {
		const scheme = selectedScheme;
		if (scheme === null) return [];
		return [...scheme.levels].sort((a, b) => a.ord - b.ord);
	});

	// The selection a level session can actually use: it must resolve
	// against the loaded schemes of the current workspace language, not
	// just against the id saved in sessionStorage. Effects and Start key
	// off this so a stale or not-yet-resolved scheme cannot fetch or start.
	const levelSelection = $derived.by((): { schemeId: number; levelName: string } | null => {
		if (!schemesLoaded) return null;
		const scheme = selectedScheme;
		const level = levelName;
		if (scheme === null || level === null) return null;
		if (!schemeLevels.some((item) => item.name === level)) return null;
		return { schemeId: scheme.id, levelName: level };
	});

	// Keep the saved selection when it still exists; otherwise fall back
	// to the first scheme/level. Clearing on an empty list means a stale
	// levels setup from another language cannot start.
	$effect(() => {
		if (!schemesLoaded) return;
		if (schemesForLanguage.length === 0) {
			if (schemeId !== null) schemeId = null;
			if (levelName !== null) levelName = null;
			return;
		}
		if (selectedScheme === null) {
			const first = schemesForLanguage[0];
			schemeId = first.id;
			levelName = [...first.levels].sort((a, b) => a.ord - b.ord)[0]?.name ?? null;
			return;
		}
		if (!schemeLevels.some((level) => level.name === levelName)) {
			levelName = schemeLevels[0]?.name ?? null;
		}
	});

	async function loadLevelEntries(id: number, level: string): Promise<void> {
		const seq = ++levelEntriesSeq;
		levelEntriesLoading = true;
		levelEntriesError = '';
		levelEntries = [];
		try {
			const list = await getSchemeEntries(id, level);
			if (seq !== levelEntriesSeq) return;
			levelEntries = list;
		} catch (err) {
			if (seq !== levelEntriesSeq) return;
			levelEntriesError = message(err, 'Could not load this level.');
		} finally {
			if (seq === levelEntriesSeq) levelEntriesLoading = false;
		}
	}

	// Fetch the chosen level's words so the counts below reflect the
	// exact level a session would study. Depending on the resolved
	// selection and the workspace id makes a same-language workspace
	// switch refetch even though the saved scheme/level stay valid.
	$effect(() => {
		const selection = levelSelection;
		if (mode !== 'levels' || activeWorkspaceId === null || selection === null) {
			levelEntriesSeq += 1;
			levelEntries = [];
			levelEntriesLoading = false;
			levelEntriesError = '';
			return;
		}
		void loadLevelEntries(selection.schemeId, selection.levelName);
	});

	// Due and new are counted separately so the setup shows what a
	// session would actually contain today. Cards reviewed but not due
	// yet belong to neither bucket.
	const deckCounts = $derived.by(() => {
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

	const levelCounts = $derived.by(() => {
		if (levelSelection === null || levelEntries.length === 0) {
			return { due: 0, fresh: 0 };
		}
		const now = new Date();
		const due = buildLevelQueue({
			entries: levelEntries,
			cards,
			reviews,
			newLimit: 0,
			reviewLimit: COUNT_CAP,
			now
		}).length;
		const fresh = buildLevelQueue({
			entries: levelEntries,
			cards,
			reviews,
			newLimit: COUNT_CAP,
			reviewLimit: 0,
			now
		}).length;
		return { due, fresh };
	});

	const counts = $derived(mode === 'levels' ? levelCounts : deckCounts);
	const levelWordCount = $derived(
		levelEntries.filter((entry) => entry.kind === 'word').length
	);

	const guidance = $derived.by(() => {
		if (noWorkspace) return 'Choose a workspace in the header to set up a study session.';
		if (loading) return 'Loading your study data…';

		if (mode === 'levels') {
			if (!schemesLoaded) return 'Loading level schemes…';
			if (schemeError) return schemeError;
			if (schemesForLanguage.length === 0) {
				return 'No level schemes are installed for this workspace language.';
			}
			if (levelSelection === null) {
				return 'Choose a scheme and a level to start.';
			}
			if (levelEntriesError) return levelEntriesError;
			if (levelEntriesLoading) return 'Loading this level…';
			if (levelEntries.length === 0) return 'This level has no words yet.';
			if (counts.due + counts.fresh === 0) {
				return 'Nothing is due and no new cards are left in this level.';
			}
			return '';
		}

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

	function selectMode(next: StudySessionMode): void {
		errors = [];
		mode = next;
	}

	function start(): void {
		const config: StudySessionConfig = {
			mode,
			// Keep both modes' fields so switching back restores the
			// selection; validateConfig reads only the active mode's.
			schemeId,
			levelName,
			deckIds: [...selectedDeckIds],
			newLimit,
			reviewLimit,
			cardTypes: [...cardTypes]
		};
		errors = validateConfig(config);
		// A saved scheme from another workspace language still has a
		// positive id and a level name, so validation alone cannot catch
		// it; the resolved selection can.
		if (errors.length === 0 && mode === 'levels' && levelSelection === null) {
			errors = ['Choose a level from a scheme installed for this workspace.'];
		}
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
		<section aria-labelledby="mode-heading">
			<h2 id="mode-heading">Session source</h2>
			<div class="modes" role="radiogroup" aria-labelledby="mode-heading">
				<label class="inline">
					<input
						type="radio"
						name="session-mode"
						value="decks"
						checked={mode === 'decks'}
						onchange={() => selectMode('decks')}
					/>
					My decks
				</label>
				<label class="inline">
					<input
						type="radio"
						name="session-mode"
						value="levels"
						checked={mode === 'levels'}
						onchange={() => selectMode('levels')}
					/>
					By level
				</label>
			</div>
		</section>

		{#if mode === 'decks'}
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
		{:else}
			<section aria-labelledby="levels-heading">
				<h2 id="levels-heading">Level</h2>
				<p class="hint">Draw words from one level of an installed scheme.</p>

				{#if schemeError}
					<p class="error" role="alert">{schemeError}</p>
				{:else if !schemesLoaded}
					<p class="hint" role="status">Loading schemes…</p>
				{:else if schemesForLanguage.length === 0}
					<p class="hint">
						No level schemes are installed for this workspace language yet.
					</p>
				{:else}
					<div class="levels">
						<label>
							Scheme
							<select bind:value={schemeId}>
								{#each schemesForLanguage as scheme (scheme.id)}
									<option value={scheme.id}>{scheme.name}</option>
								{/each}
							</select>
						</label>
						<label>
							Level
							<select bind:value={levelName}>
								{#each schemeLevels as level (level.id)}
									<option value={level.name}>{level.name}</option>
								{/each}
							</select>
						</label>
					</div>

					{#if levelEntriesError}
						<p class="error" role="alert">{levelEntriesError}</p>
					{:else if levelEntriesLoading}
						<p class="hint" role="status">Loading this level…</p>
					{/if}
				{/if}
			</section>
		{/if}

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
			{#if mode === 'levels'}
				<p class="stats">
					<strong>{levelWordCount}</strong>
					{levelWordCount === 1 ? 'word' : 'words'} in
					<strong>{selectedScheme?.name ?? 'this scheme'}</strong>
					{levelSelection?.levelName ?? ''} ·
					<strong>{counts.due}</strong>
					due ·
					<strong>{counts.fresh}</strong>
					new
				</p>
			{:else}
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
			{/if}

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
	.limits label,
	.levels label {
		display: grid;
		gap: 0.35rem;
		font-weight: 600;
	}

	.limits {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.modes,
	.levels {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.modes {
		gap: 1.5rem;
	}

	.create input,
	.limits input,
	.levels select,
	.rename input,
	.setup button {
		font: inherit;
	}

	.create input,
	.limits input,
	.levels select,
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
