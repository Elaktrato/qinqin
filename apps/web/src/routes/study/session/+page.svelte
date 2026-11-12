<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getEntry } from '$lib/api/entries';
	import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
	import { ApiError, api } from '$lib/api/client';
	import type { Entry, EntryBase } from '$lib/api/types';
	import type { StudyEvent } from '$lib/events';
	import { formatReading } from '$lib/format';
	import { buildVocabFaces } from '$lib/study/cardView';
	import { flushPendingReviews, recordReview } from '$lib/study/events';
	import { gradeItem } from '$lib/study/grade';
	import { buildLevelQueue, type LevelQueueItem } from '$lib/study/levelQueue';
	import { buildQueue, levelFromXp, xpFromReviews } from '$lib/study/scheduler';
	import { SESSION_CONFIG_KEY, loadConfig } from '$lib/study/session';
	import { addCard, loadStudyData } from '$lib/study/store';
	import type { ReviewEvent, ReviewGrade, StudyCard } from '$lib/study/types';
	import { newUlid } from '$lib/ulid';
	import { workspaces } from '$lib/workspaces';

	const GRADE_KEYS: Record<string, ReviewGrade> = { '1': 1, '2': 2, '3': 3, '4': 4 };
	const GRADE_LABELS: { grade: ReviewGrade; label: string; hint: string }[] = [
		{ grade: 1, label: 'Again', hint: 'Press 1' },
		{ grade: 2, label: 'Hard', hint: 'Press 2' },
		{ grade: 3, label: 'Good', hint: 'Press 3' },
		{ grade: 4, label: 'Easy', hint: 'Press 4' }
	];

	// The SPA has no SSR, so the tab's setup is readable during init.
	const config = loadConfig();

	/**
	 * One queue entry in either mode. Deck sessions map every study card
	 * directly; level sessions add items whose card does not exist yet
	 * (`virtual`), carrying the real card once one is known.
	 */
	interface SessionItem {
		cardId: string;
		entryId: number;
		virtual: boolean;
		card: StudyCard | null;
	}

	function deckItems(cards: readonly StudyCard[]): SessionItem[] {
		return cards.map((card) => ({
			cardId: card.id,
			entryId: card.entryId,
			virtual: false,
			card
		}));
	}

	function levelItems(
		items: readonly LevelQueueItem[],
		cards: readonly StudyCard[]
	): SessionItem[] {
		const byId = new Map(cards.map((card) => [card.id, card]));
		return items.map((item) => ({
			cardId: item.cardId,
			entryId: item.entryId,
			virtual: item.virtual,
			card: item.virtual ? null : (byId.get(item.cardId) ?? null)
		}));
	}

	/**
	 * A levels session belongs to the workspace language it was set up
	 * in. The scheme list is global, so the saved id/level must be
	 * re-validated against the current workspace: a mid-session switch
	 * to another language must abort instead of studying (or writing)
	 * cards in the wrong workspace.
	 */
	class LevelWorkspaceMismatch extends Error {}

	/** levelEntriesRequest loads the configured level, or nothing in decks mode. */
	async function levelEntriesRequest(language: string | null): Promise<EntryBase[]> {
		if (config.mode !== 'levels') return [];
		if (config.schemeId === null || config.levelName === null) {
			return Promise.reject(new Error('This level session is missing its scheme or level.'));
		}

		const schemes = await getSchemes();
		const scheme = schemes.find(
			(candidate) => candidate.id === config.schemeId && candidate.language === language
		);
		if (scheme === undefined) {
			throw new LevelWorkspaceMismatch(
				'This level scheme is not installed for the current workspace language. Start a new session from the study setup.'
			);
		}
		if (!scheme.levels.some((level) => level.name === config.levelName)) {
			throw new LevelWorkspaceMismatch(
				`The level “${config.levelName}” no longer exists in ${scheme.name}. Start a new session from the study setup.`
			);
		}
		return getSchemeEntries(config.schemeId, config.levelName);
	}

	/**
	 * loadConfig always falls back to the defaults. A direct visit to the
	 * runner has no setup to honour, so it is sent back to the setup page
	 * instead of silently studying the default decks. Blocked storage must
	 * not redirect: saving a setup would fail forever and loop.
	 */
	function sessionConfigPresent(): boolean {
		try {
			if (typeof sessionStorage === 'undefined') return true;
			return sessionStorage.getItem(SESSION_CONFIG_KEY) !== null;
		} catch {
			return true;
		}
	}

	const missingConfig = !sessionConfigPresent();

	let loading = $state(true);
	let loadError = $state('');
	let workspaceMismatch = $state('');
	let noWorkspace = $state(false);
	let sessionWorkspaceId = $state<number | null>(null);
	let queue = $state<SessionItem[]>([]);
	let reviews = $state<ReviewEvent[]>([]);
	let sessionReviews = $state<ReviewEvent[]>([]);
	let index = $state(0);
	let revealed = $state(false);
	let entries = $state<Record<number, Entry>>({});
	let entryError = $state('');
	let gradeError = $state('');
	let grading = $state(false);

	// A non-reactive in-flight marker: only the cache and the error are
	// rendered, so an entry load must not re-trigger itself.
	let pendingEntryId: number | null = null;

	// Guards a slow load from an earlier workspace overwriting the session.
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
	 * sessionReview mirrors the event recordReview builds, so the
	 * session's XP is computed from the same shape as the stored log.
	 * XP depends only on the grade, so the local copy stays accurate even
	 * when the POST is queued for retry.
	 */
	function sessionReview(
		card: StudyCard,
		grade: ReviewGrade,
		workspaceId: number
	): ReviewEvent {
		return {
			id: newUlid(),
			workspaceId,
			device: 'web',
			ts: new Date().toISOString(),
			type: 'review',
			payload: { cardId: card.id, mode: 'vocab', grade }
		};
	}

	const currentItem = $derived(queue[index]);
	const currentEntry = $derived(
		currentItem === undefined ? undefined : entries[currentItem.entryId]
	);

	// A sentence id that no longer resolves is passed as null so the card
	// simply has no sentence block, matching a card without one. A virtual
	// level card previews the sentence it will be created with.
	const faces = $derived.by(() => {
		const item = currentItem;
		const entry = currentEntry;
		if (item === undefined || entry === undefined) return null;
		const sentence = item.virtual
			? (entry.sentences[0] ?? null)
			: item.card?.sentenceId === undefined
				? null
				: (entry.sentences.find((candidate) => candidate.id === item.card?.sentenceId) ??
					null);
		return buildVocabFaces(entry, sentence, entry.language);
	});

	const complete = $derived(
		!loading &&
			loadError === '' &&
			!noWorkspace &&
			queue.length > 0 &&
			index >= queue.length
	);

	const sessionXp = $derived(xpFromReviews(sessionReviews));
	const totalLevel = $derived(levelFromXp(xpFromReviews([...reviews, ...sessionReviews])));

	async function loadEntry(entryId: number): Promise<void> {
		if (entries[entryId] !== undefined || pendingEntryId === entryId) return;

		const seq = requestSeq;
		pendingEntryId = entryId;
		entryError = '';
		try {
			const entry = await getEntry(entryId);
			if (seq !== requestSeq) return;
			entries = { ...entries, [entryId]: entry };
		} catch (err) {
			if (seq !== requestSeq) return;
			entryError = message(err, 'Could not load this word.');
		} finally {
			if (seq === requestSeq && pendingEntryId === entryId) {
				pendingEntryId = null;
			}
		}
	}

	/** ensureEntry loads a card's entry once, on its first display. */
	function ensureEntry(item: SessionItem | undefined): void {
		if (item === undefined) return;
		entryError = '';
		if (entries[item.entryId] !== undefined) return;
		void loadEntry(item.entryId);
	}

	async function load(workspaceId: number | null, language: string | null): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		loadError = '';
		workspaceMismatch = '';
		noWorkspace = false;
		sessionWorkspaceId = workspaceId;
		queue = [];
		reviews = [];
		sessionReviews = [];
		index = 0;
		revealed = false;
		entries = {};
		entryError = '';
		gradeError = '';
		grading = false;
		pendingEntryId = null;

		if (workspaceId === null) {
			noWorkspace = true;
			loading = false;
			return;
		}

		try {
			// Queued reviews must land before the history is read: the
			// queue is built from those events, and a review still in the
			// outbox would let the same card be graded twice. A failed
			// retry leaves the queue for the next boot and never blocks
			// the session.
			try {
				await flushPendingReviews();
			} catch {
				// The outbox retries on the next boot or reconnect.
			}
			const [data, events, schemeEntries] = await Promise.all([
				loadStudyData(),
				api<StudyEvent[]>(
					`/api/events?since=1970-01-01T00:00:00Z&workspace=${workspaceId}`
				),
				levelEntriesRequest(language)
			]);
			if (seq !== requestSeq) return;

			const history = events
				.map((event) => asReview(event, workspaceId))
				.filter((event): event is ReviewEvent => event !== null);
			reviews = history;
			if (config.mode === 'levels') {
				queue = levelItems(
					buildLevelQueue({
						entries: schemeEntries,
						cards: data.cards,
						reviews: history,
						newLimit: config.newLimit,
						reviewLimit: config.reviewLimit,
						now: new Date()
					}),
					data.cards
				);
			} else {
				queue = deckItems(
					buildQueue({
						cards: data.cards,
						reviews: history,
						deckIds: config.deckIds,
						newLimit: config.newLimit,
						reviewLimit: config.reviewLimit,
						now: new Date()
					})
				);
			}
			ensureEntry(queue[0]);
		} catch (err) {
			if (seq !== requestSeq) return;
			queue = [];
			if (err instanceof LevelWorkspaceMismatch) {
				workspaceMismatch = err.message;
			} else {
				loadError = message(err, 'Could not start your session.');
			}
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	function retryLoad(): void {
		void load($workspaces.current?.id ?? null, $workspaces.current?.language ?? null);
	}

	function retryEntry(): void {
		ensureEntry(currentItem);
	}

	function reveal(): void {
		if (faces !== null) revealed = true;
	}

	/**
	 * submitGrade runs the extracted grade transaction. A virtual item
	 * creates its card first inside gradeItem, so the review always names
	 * a real id; a failure leaves the queue untouched and surfaces inline.
	 * recordReview keeps a failed POST in the outbox, so the review is
	 * never lost even though the append is awaited here.
	 */
	async function submitGrade(value: ReviewGrade): Promise<void> {
		const item = currentItem;
		const workspaceId = sessionWorkspaceId;
		if (!revealed || item === undefined || workspaceId === null || grading) return;

		gradeError = '';
		grading = true;
		try {
			const result = await gradeItem({
				item,
				grade: value,
				workspaceId,
				currentWorkspaceId: $workspaces.current?.id ?? null,
				entry: entries[item.entryId] ?? null,
				addCard,
				recordReview
			});
			if (!result.ok) {
				if (sessionWorkspaceId === workspaceId) gradeError = result.error;
				return;
			}
			if (sessionWorkspaceId !== workspaceId) return;

			sessionReviews = [...sessionReviews, sessionReview(result.card, value, workspaceId)];
			revealed = false;
			index += 1;
			ensureEntry(queue[index]);
		} finally {
			grading = false;
		}
	}

	/**
	 * Keyboard shortcuts stay out of the way of forms: focused inputs,
	 * buttons, and links keep their native Space/Enter behaviour.
	 */
	function isInteractive(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return (
			target.closest('input, textarea, select, button, a, [contenteditable="true"]') !== null
		);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.repeat) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isInteractive(event.target)) return;
		if (faces === null || complete) return;

		if (!revealed) {
			if (event.key === ' ' || event.key === 'Enter') {
				event.preventDefault();
				reveal();
			}
			return;
		}

		const value = GRADE_KEYS[event.key];
		if (value !== undefined) {
			event.preventDefault();
			void submitGrade(value);
		}
	}

	onMount(() => {
		if (missingConfig) void goto('/study');
	});

	// Refetch when the active workspace changes; the header switcher makes
	// that possible without leaving the page, and the session is
	// workspace-scoped just like the setup that created it.
	$effect(() => {
		if (missingConfig) return;
		const workspace = $workspaces.current;
		void load(workspace?.id ?? null, workspace?.language ?? null);
	});
</script>

<svelte:window onkeydown={onKeydown} />

<main class="session">
	{#if missingConfig}
		<p class="hint" role="status">Opening study setup…</p>
	{:else if workspaceMismatch}
		<section class="state" aria-labelledby="mismatch-heading">
			<h1 id="mismatch-heading">Session unavailable</h1>
			<p class="error" role="alert">{workspaceMismatch}</p>
			<a href="/study">Back to study setup</a>
		</section>
	{:else if loadError}
		<section class="state" aria-labelledby="error-heading">
			<h1 id="error-heading">Session unavailable</h1>
			<p class="error" role="alert">{loadError}</p>
			<button type="button" onclick={retryLoad}>Retry</button>
			<a href="/study">Back to study setup</a>
		</section>
	{:else if noWorkspace}
		<section class="state">
			<h1>No workspace</h1>
			<p class="hint">Choose a workspace in the header to study.</p>
			<a href="/study">Back to study setup</a>
		</section>
	{:else if loading}
		<p class="hint" role="status">Loading your session…</p>
	{:else if queue.length === 0}
		<section class="state" aria-labelledby="empty-heading">
			<h1 id="empty-heading">Nothing to study</h1>
			<p>Nothing due — add words or raise your limits</p>
			<a href="/study">Back to study setup</a>
		</section>
	{:else if complete}
		<section class="summary" aria-labelledby="summary-heading">
			<h1 id="summary-heading">Session complete</h1>
			<p class="stat">
				<strong>{sessionReviews.length}</strong>
				{sessionReviews.length === 1 ? 'review' : 'reviews'}
			</p>
			<p class="stat"><strong>+{sessionXp}</strong> XP this session</p>
			<p class="stat">Level <strong>{totalLevel}</strong></p>
			<a href="/study">Back to study setup</a>
		</section>
	{:else}
		<header class="top">
			<h1>Study</h1>
			<p class="progress" aria-live="polite">{index + 1} / {queue.length}</p>
			<a href="/study">End session</a>
		</header>

		{#if entryError}
			<section class="state">
				<p class="error" role="alert">{entryError}</p>
				<button type="button" onclick={retryEntry}>Retry</button>
			</section>
		{:else if faces === null}
			<p class="hint" role="status">Loading card…</p>
		{:else}
			<article class="card">
				<p class="written">{faces.front.written}</p>

				{#if faces.front.readings.length > 0}
					<ul class="readings" aria-label="Readings">
						{#each faces.front.readings as reading, readingIndex (`${reading.type}:${readingIndex}`)}
							<li data-type={reading.type}>{formatReading(reading.type, reading.value)}</li>
						{/each}
					</ul>
				{/if}

				{#if faces.front.sentenceLines.length > 0}
					<div class="sentences">
						{#each faces.front.sentenceLines as line, lineIndex (lineIndex)}
							<p class="sentence">{line}</p>
						{/each}
					</div>
				{/if}

				{#if revealed}
					<section class="answer" aria-labelledby="answer-heading">
						<h2 id="answer-heading">Answer</h2>
						{#if faces.back.glosses.length > 0}
							{#each faces.back.glosses as group (group.dictionaryName)}
								<article class="dictionary">
									<h3>{group.dictionaryName}</h3>
									<ol class="glosses">
										{#each group.glosses as gloss, glossIndex (glossIndex)}
											<li>{gloss}</li>
										{/each}
									</ol>
								</article>
							{/each}
						{:else}
							<p class="hint">No glosses for this word yet.</p>
						{/if}
					</section>
				{:else}
					<button type="button" class="reveal" onclick={reveal}>Show answer</button>
				{/if}

				{#if gradeError}
					<p class="error" role="alert">{gradeError}</p>
				{/if}

				<div class="grades">
					{#each GRADE_LABELS as item (item.grade)}
						<button
							type="button"
							class="grade grade-{item.grade}"
							disabled={!revealed || grading}
							title={item.hint}
							onclick={() => void submitGrade(item.grade)}
						>
							{item.label}
						</button>
					{/each}
				</div>
			</article>
		{/if}
	{/if}
</main>

<style>
	.session {
		margin: 0 auto;
		max-width: 44rem;
		padding: 2.5rem 1.5rem;
	}

	h1,
	h2,
	h3 {
		margin-bottom: 0.5rem;
	}

	.hint {
		opacity: 0.75;
	}

	.error {
		margin: 0.5rem 0 0;
		color: #c62828;
		font-weight: 600;
	}

	.state {
		margin-top: 1.5rem;
		border: 1px dashed color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 0.4rem;
		padding: 1rem 1.15rem;
	}

	.state h1 {
		margin-top: 0;
	}

	.state a,
	.summary a {
		display: inline-block;
		margin-top: 0.75rem;
	}

	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}

	.top h1 {
		margin: 0;
	}

	.progress {
		margin: 0;
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}

	.top a {
		margin-left: auto;
	}

	.card {
		margin-top: 1.5rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.6rem;
		padding: 1.5rem;
	}

	.written {
		margin: 0;
		font-size: 2.75rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.readings {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		opacity: 0.85;
	}

	.sentences {
		margin-top: 1.25rem;
		display: grid;
		gap: 0.35rem;
	}

	.sentence {
		margin: 0;
		font-size: 1.15rem;
	}

	.reveal {
		margin-top: 1.5rem;
		padding: 0.55rem 1rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.answer {
		margin-top: 1.5rem;
		border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		padding-top: 1rem;
	}

	.answer h2 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.dictionary + .dictionary {
		margin-top: 0.9rem;
	}

	.dictionary h3 {
		margin: 0;
		font-size: 1rem;
	}

	.glosses {
		margin: 0.35rem 0 0;
		padding-left: 1.4rem;
		display: grid;
		gap: 0.25rem;
	}

	.grades {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1.5rem;
	}

	.session button {
		font: inherit;
	}

	.grades button {
		flex: 1 1 6rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.grade-3 {
		border-color: #0b6bcb;
	}

	.grade-4 {
		border-color: #2e7d32;
	}

	.session button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.stat {
		margin: 0.4rem 0;
		font-size: 1.1rem;
	}
</style>
