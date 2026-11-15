<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolveAudio, type AudioResolution } from '$lib/api/audio';
	import { getEntry } from '$lib/api/entries';
	import { token } from '$lib/auth';
	import { activate, headwordClips } from '$lib/audio/button';
	import { readAudioSettings } from '$lib/audio/settings';
	import { getPlayer } from '$lib/audio/shared';
	import { autoplayDue, cardAudio, isPlayKey, preloadClips } from '$lib/study/audioCue';
	import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
	import { ApiError } from '$lib/api/client';
	import type { Entry, EntryBase, Sentence } from '$lib/api/types';
	import SentenceCard from '$lib/plugins/flashcards/cards/SentenceCard.svelte';
	import ToneCard from '$lib/plugins/flashcards/cards/ToneCard.svelte';
	import VocabCard from '$lib/plugins/flashcards/cards/VocabCard.svelte';
	import WritingCard from '$lib/plugins/flashcards/cards/WritingCard.svelte';
	import {
		cardedSentenceIds,
		deckSessionPlan,
		dropItem,
		isEligible,
		levelSessionItems,
		rememberDrop,
		resolveSentence,
		reviewCountFor,
		shouldIgnoreGrade,
		tierForCard,
		type CardResult,
		type FlowItem
	} from '$lib/study/cardFlow';
	import { flushPendingReviews, recordReview } from '$lib/study/events';
	import { ineligibleKey, loadIneligible, rememberIneligible } from '$lib/study/ineligible';
	import { dailyStreak, levelProgress, xpByKind, xpFromReviews } from '$lib/study/exp';
	import Mascot from '$lib/plugins/flashcards/Mascot.svelte';
	import { gradeItem } from '$lib/study/grade';
	import { DEFAULT_W } from '$lib/study/fsrs/params';
	import { buildLevelQueue } from '$lib/study/levelQueue';
	import { MAX_RESHOWS, applyGrade, progressOf, removeAt } from '$lib/study/requeue';
	import { SESSION_CONFIG_KEY, loadConfig } from '$lib/study/session';
	import { activeWeights, addCard, loadStudyData } from '$lib/study/store';
	import {
		CARD_KINDS,
		type ReviewEvent,
		type ReviewGrade,
		type ReviewMeta,
		type StudyCard,
		type StudyCardKind
	} from '$lib/study/types';
	import type { SaladTier } from '$lib/study/wordSalad';
	import { usableChars } from '$lib/study/writing';
	import { newUlid } from '$lib/ulid';
	import { workspaces } from '$lib/workspaces';

	const GRADE_KEYS: Record<string, ReviewGrade> = { '1': 1, '2': 2, '3': 3, '4': 4 };
	const GRADE_LABELS: { grade: ReviewGrade; label: string }[] = [
		{ grade: 1, label: 'Again' },
		{ grade: 2, label: 'Hard' },
		{ grade: 3, label: 'Good' },
		{ grade: 4, label: 'Easy' }
	];

	const KIND_LABELS: Record<StudyCardKind, string> = {
		vocab: 'Vocab',
		sentence: 'Word Salad',
		writing: 'Writing',
		tone: 'Tone'
	};

	const STUDY_KINDS: StudyCardKind[] = ['vocab', 'sentence', 'writing', 'tone'];

	const TIER_LABELS: Record<SaladTier, string> = {
		0: 'Tier 0 · words, translation shown',
		1: 'Tier 1 · words, translation hidden',
		2: 'Tier 2 · single characters'
	};

	// The key map per kind, shown under the grade buttons.
	const KEY_HINTS: Record<StudyCardKind, string> = {
		vocab: 'Keys: Space or Enter shows the answer · 1–4 grade',
		sentence: 'Tap the tiles in order, then Check · keys 1–4 grade once checked',
		writing: 'Draw each character stroke by stroke · keys 1–4 grade when finished',
		tone: 'Keys: 1–5 set the highlighted syllable’s tone (5 = neutral) · ←/→ move · Backspace clears · Enter checks · then 1–4 grade'
	};

	// The SPA has no SSR, so the tab's setup is readable during init.
	const config = loadConfig();
	const kinds: StudyCardKind[] = CARD_KINDS.filter((kind) => config.cardTypes.includes(kind));

	/**
	 * A queue item once it can be shown: its entry is loaded and its kind
	 * is eligible for the word. Sentence cards carry their sentence,
	 * writing cards the characters that have stroke data.
	 */
	interface Resolved {
		item: FlowItem;
		entry: Entry;
		sentence: Sentence | null;
		chars: string[];
		tier: SaladTier;
		seed: string;
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
	let sessionLanguage = $state('');
	let cards = $state.raw<StudyCard[]>([]);
	let queue = $state.raw<FlowItem[]>([]);
	// Deck-session companions held back beyond the new-card budget; one
	// replaces each companion dropped as ineligible.
	let reserve = $state.raw<FlowItem[]>([]);
	let backfillLeft = 0;
	let reviews = $state.raw<ReviewEvent[]>([]);
	// The weights loaded with this session; a change elsewhere waits for the next load.
	let weights = $state.raw<readonly number[]>(DEFAULT_W);
	let sessionReviews = $state.raw<ReviewEvent[]>([]);
	let index = $state(0);
	// Re-shows answered this session; practice only, never recorded.
	let reshown = $state(0);
	let entries = $state.raw<Record<number, Entry>>({});
	// The recordings of every entry in the queue, resolved once per session.
	let audioMap = $state.raw<Record<string, AudioResolution>>({});
	let entryError = $state('');
	let gradeError = $state('');
	let grading = $state(false);

	// The card being shown and how far the learner got with it. `done`
	// unlocks the grade buttons; `suggested` is preselected on them.
	let resolved = $state.raw<Resolved | null>(null);
	let done = $state(false);
	let suggested = $state<ReviewGrade | null>(null);
	let doneMeta = $state.raw<ReviewMeta>({});
	let shownAt = 0;
	// When the suggested grade button received focus; null when not focused.
	let suggestionFocusedAt: number | null = null;
	let resolveSeq = 0;
	let gradeButtons = $state<(HTMLButtonElement | null)[]>([]);

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
	 * sessionReview mirrors the event recordReview builds (with the card's
	 * real kind as the mode, and the meta), so the session's XP is computed
	 * from the same shape as the stored log, even when the POST is queued
	 * for retry.
	 */
	function sessionReview(
		card: StudyCard,
		grade: ReviewGrade,
		workspaceId: number,
		mode: StudyCardKind,
		meta: ReviewMeta
	): ReviewEvent {
		return {
			id: newUlid(),
			workspaceId,
			device: 'web',
			ts: new Date().toISOString(),
			type: 'review',
			payload: { cardId: card.id, mode, grade, meta }
		};
	}

	const currentItem = $derived(queue[index]);
	const queueProgress = $derived(progressOf(queue, index));
	const currentEntry = $derived(
		currentItem === undefined ? undefined : entries[currentItem.entryId]
	);

	const complete = $derived(
		!loading &&
			loadError === '' &&
			!noWorkspace &&
			queue.length > 0 &&
			index >= queue.length
	);

	// XP is the difference the session made to the whole log, so the
	// daily bonus is only counted when this session earned it.
	const historyXp = $derived(xpFromReviews(reviews));
	const totalXp = $derived(xpFromReviews([...reviews, ...sessionReviews]));
	const sessionXp = $derived(totalXp - historyXp);
	const progress = $derived(levelProgress(totalXp));
	const streak = $derived(dailyStreak([...reviews, ...sessionReviews], Date.now()));
	// Per-kind XP of this session; whatever the kinds do not explain is
	// the daily bonus.
	const kindXp = $derived(xpByKind(sessionReviews));
	const dailyBonusXp = $derived(
		sessionXp - Object.values(kindXp).reduce((sum, value) => sum + value, 0)
	);

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
	function ensureEntry(item: FlowItem | undefined): void {
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
		sessionLanguage = language ?? '';
		cards = [];
		queue = [];
		reserve = [];
		backfillLeft = 0;
		reviews = [];
		sessionReviews = [];
		index = 0;
		reshown = 0;
		entries = {};
		audioMap = {};
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
			// Duplicate cards arrive merged, their reviews re-pointed.
			const [data, schemeEntries] = await Promise.all([
				loadStudyData(workspaceId),
				levelEntriesRequest(language)
			]);
			if (seq !== requestSeq) return;

			const history = data.reviews;
			reviews = history;
			weights = activeWeights(data);
			const w = weights;
			cards = data.cards;
			const now = new Date();
			if (config.mode === 'levels') {
				// Level sessions stay vocab-only; companions are deck-only.
				queue = levelSessionItems(
					buildLevelQueue({
						entries: schemeEntries,
						cards: data.cards,
						reviews: history,
						newLimit: config.newLimit,
						reviewLimit: config.reviewLimit,
						now,
						w
					}),
					data.cards,
					kinds
				);
			} else {
				const plan = deckSessionPlan({
					cards: data.cards,
					reviews: history,
					deckIds: config.deckIds,
					kinds,
					newLimit: config.newLimit,
					reviewLimit: config.reviewLimit,
					now,
					w,
					language: language ?? '',
					// Words this tab already found unsuitable are not fetched again.
					skip: loadIneligible(workspaceId)
				});
				queue = plan.queue;
				reserve = plan.reserve;
				backfillLeft = plan.backfillLeft;
			}
			ensureEntry(queue[0]);
			prefetchAudio(seq);
		} catch (err) {
			if (seq !== requestSeq) return;
			queue = [];
			reserve = [];
			if (err instanceof LevelWorkspaceMismatch) {
				workspaceMismatch = err.message;
			} else {
				loadError = message(err, 'Could not start your session.');
			}
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	/**
	 * resolveItem decides whether an item can be shown now and gathers
	 * what its card needs. Null means ineligible: the item is dropped from
	 * this session, and a virtual one is never created.
	 */
	async function resolveItem(item: FlowItem, entry: Entry): Promise<Resolved | null> {
		const language = sessionLanguage || entry.language;
		const now = new Date();
		const history = [...reviews, ...sessionReviews];
		const base: Resolved = {
			item,
			entry,
			sentence: null,
			chars: [],
			tier: 0,
			seed: item.cardId
		};

		switch (item.kind) {
			case 'vocab':
				return base;
			case 'sentence': {
				const usable = entry.sentences.filter((sentence) => sentence.hanzi.trim() !== '');
				// A companion takes the word's first sentence without a card;
				// an existing card keeps its own sentence, or shows the word's
				// first one when its sentence is gone.
				const sentence = resolveSentence(item, usable, cardedSentenceIds(cards, item.entryId));
				if (!isEligible('sentence', entry, { language, hasSentence: sentence !== null })) {
					return null;
				}
				const cardId = item.virtual ? null : item.cardId;
				return {
					...base,
					item: item.virtual ? { ...item, sentenceId: sentence?.id } : item,
					sentence,
					tier: item.tier ?? tierForCard(cardId, history, now, weights),
					seed: `${item.card?.id ?? item.cardId}:${reviewCountFor(cardId, history)}`
				};
			}
			case 'writing': {
				const chars = await usableChars(item.written ?? entry.written);
				if (!isEligible('writing', entry, { language, hasSentence: false, usableChars: chars })) {
					return null;
				}
				return { ...base, chars };
			}
			case 'tone':
				return isEligible('tone', entry, { language, hasSentence: false }) ? base : null;
			default:
				return null;
		}
	}

	/**
	 * dropIneligible removes an ineligible item (nothing is written); a
	 * dropped companion is replaced by the next reserve companion while the
	 * session's backfill bound lasts. A non-null `entry` that definitively
	 * lacks what the kind needs (see `rememberDrop`) is remembered: this tab skips
	 * the word for that kind in later sessions. Failures that may be
	 * transient (a rejected resolution, missing stroke data) are not
	 * remembered.
	 */
	function dropIneligible(item: FlowItem, entry: Entry | null): void {
		const workspaceId = sessionWorkspaceId;
		if (
			entry !== null &&
			workspaceId !== null &&
			rememberDrop(item, item.written ?? entry.written)
		) {
			rememberIneligible(workspaceId, ineligibleKey(item.kind, item.entryId));
		}
		if (item.reshow !== undefined) {
			// A re-show that cannot be shown again is just skipped.
			queue = removeAt(queue, index);
			ensureEntry(queue[index]);
			return;
		}
		const next = dropItem({ queue, reserve, backfillLeft }, item.cardId);
		queue = next.queue;
		reserve = next.reserve;
		backfillLeft = next.backfillLeft;
		ensureEntry(queue[index]);
	}

	/**
	 * Resolve the recordings of the whole queue once, for signed-in users:
	 * one request per 200 entries. A failure only means no recordings; a
	 * card never waits on it.
	 */
	function prefetchAudio(seq: number): void {
		if (!$token) return;
		const ids = [...queue, ...reserve].filter((i) => i.kind === 'vocab' || i.kind === 'tone').map((i) => i.entryId);
		if (ids.length === 0) return;
		void resolveAudio(ids).then((found) => {
			if (seq === requestSeq) audioMap = found;
		});
	}

	const audioSettings = $derived(readAudioSettings($workspaces.current?.settings));
	// Only vocab and tone cards pronounce their word.
	const currentAudio = $derived(
		resolved !== null && (resolved.item.kind === 'vocab' || resolved.item.kind === 'tone')
			? cardAudio(resolved.entry, audioMap[String(resolved.item.entryId)], audioSettings)
			: null
	);
	let autoplayedFor: string | null = null;

	function playCurrent(): void {
		if (currentAudio === null) return;
		void activate(getPlayer(), currentAudio, currentAudio.lang).catch(() => {});
	}

	// Autoplay: once per card, right after the reveal, only when the workspace
	// setting is on (it is off by default).
	$effect(() => {
		const key = resolved === null ? '' : `${index}:${resolved.item.cardId}`;
		const due = autoplayDue({ done, autoplay: audioSettings.autoplay, playedFor: autoplayedFor, key });
		if (!due || key === '') return;
		autoplayedFor = key;
		untrack(playCurrent);
	});

	// Warm the next card's recording while this one is on screen.
	$effect(() => {
		const next = queue[index + 1];
		const res = next === undefined ? undefined : audioMap[String(next.entryId)];
		if (res !== undefined && (next?.kind === 'vocab' || next?.kind === 'tone')) {
			preloadClips({ clips: headwordClips(res), speakText: '', lang: '', deviceVoice: false });
		}
	});

	// Resolve the current item whenever it (or its entry) changes. The
	// card state resets with it, so a new card always starts unanswered.
	$effect(() => {
		const item = currentItem;
		const entry = currentEntry;
		const seq = ++resolveSeq;
		untrack(() => {
			resolved = null;
			done = false;
			suggested = null;
			doneMeta = {};
			gradeError = '';
		});
		if (item === undefined || entry === undefined) return;

		void untrack(() => resolveItem(item, entry)).then(
			(result) => {
				if (seq !== resolveSeq) return;
				if (result === null) {
					dropIneligible(item, entry);
					return;
				}
				shownAt = Date.now();
				resolved = result;
			},
			() => {
				if (seq === resolveSeq) dropIneligible(item, null);
			}
		);
	});

	function retryLoad(): void {
		void load($workspaces.current?.id ?? null, $workspaces.current?.language ?? null);
	}

	function retryEntry(): void {
		ensureEntry(currentItem);
	}


	/** onCardDone unlocks grading and preselects the card's suggestion. */
	async function onCardDone(result: CardResult): Promise<void> {
		if (resolved === null || done) return;
		done = true;
		suggestionFocusedAt = null;
		// Easy is never suggested automatically.
		suggested = result.suggested === 4 ? 3 : result.suggested;
		doneMeta = { ...result.meta, durationMs: Math.max(0, Date.now() - shownAt) };
		if (suggested !== null) {
			// Focus the suggestion so Enter/Space (or 1–4) confirms it and a
			// tile or pad no longer holds focus.
			await tick();
			const button = gradeButtons[suggested - 1];
			if (button) {
				button.focus();
				suggestionFocusedAt = Date.now();
			}
		}
	}

	function revealVocab(): void {
		if (resolved?.item.kind !== 'vocab') return;
		void onCardDone({ suggested: null, meta: {} });
	}

	/**
	 * submitGrade runs the extracted grade transaction with the card's
	 * real kind as the mode. A virtual item creates its card first inside
	 * gradeItem (only now: abandoning a session creates nothing), so the
	 * review always names a real id; a failure leaves the queue untouched
	 * and surfaces inline. recordReview keeps a failed POST in the outbox.
	 */
	async function submitGrade(
		value: ReviewGrade,
		source: 'key-digit' | 'click' | 'activation'
	): Promise<void> {
		const current = resolved;
		const workspaceId = sessionWorkspaceId;
		if (!done || current === null || workspaceId === null || grading) return;
		if (
			shouldIgnoreGrade({
				now: Date.now(),
				focusedAt: suggestionFocusedAt,
				source,
				hadSuggestion: suggested !== null
			})
		) {
			return;
		}

		const item = current.item;
		const meta: ReviewMeta = { ...doneMeta };

		gradeError = '';
		grading = true;
		try {
			const step = await applyGrade({
				queue,
				index,
				grade: value,
				tier: current.tier,
				record: () =>
					gradeItem({
						item,
						grade: value,
						workspaceId,
						mode: item.kind,
						meta,
						currentWorkspaceId: $workspaces.current?.id ?? null,
						entry: current.entry,
						addCard,
						recordReview
					})
			});
			if (!step.ok) {
				if (sessionWorkspaceId === workspaceId) gradeError = step.error;
				return;
			}
			if (sessionWorkspaceId !== workspaceId) return;

			const result = step.recorded;
			if (result === null) {
				// A re-show is practice: no review event, so FSRS, XP, streak and
				// the log count the card once.
				reshown += 1;
			} else {
				// addCard may hand back a card this page already holds.
				if (result.created && !cards.some((card) => card.id === result.card.id)) {
					cards = [...cards, result.card];
				}
				sessionReviews = [
					...sessionReviews,
					sessionReview(result.card, value, workspaceId, item.kind, meta)
				];
			}
			// The focused grade button is disabled for the next card; drop the
			// focus so Space/Enter reach the window in every browser.
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			queue = step.queue;
			index = step.index;
			ensureEntry(queue[index]);
		} finally {
			grading = false;
		}
	}

	/** Focused form controls, buttons and links keep native Space/Enter. */
	function isInteractive(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return (
			target.closest('input, textarea, select, button, a, [contenteditable="true"]') !== null
		);
	}

	/**
	 * Grade digits never fire into a text field or while a card's own
	 * input (writing pad, word tiles, tone pads) holds focus.
	 */
	function blocksGradeKeys(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return (
			target.closest('input, textarea, select, [contenteditable="true"], [data-card-input]') !==
			null
		);
	}

	/**
	 * Key map: vocab — Space/Enter reveal, then 1–4 grade. Other kinds own
	 * their keys until the learner finishes the card (tone uses 1–5 for
	 * tones), then 1–4 grade. The runner never handles a key before then.
	 */
	function onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.repeat) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const current = resolved;
		if (current === null || complete) return;

		if (!done) {
			if (current.item.kind !== 'vocab' || isInteractive(event.target)) return;
			if (event.key === ' ' || event.key === 'Enter') {
				event.preventDefault();
				revealVocab();
			}
			return;
		}

		if (blocksGradeKeys(event.target)) return;
		if (isPlayKey(event) && currentAudio !== null) {
			// Only after the reveal: this branch is past the `!done` return.
			event.preventDefault();
			playCurrent();
			return;
		}
		const value = GRADE_KEYS[event.key];
		if (value !== undefined) {
			event.preventDefault();
			void submitGrade(value, 'key-digit');
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
			{#if reshown > 0}
				<p class="stat">
					<strong>{reshown}</strong> re-{reshown === 1 ? 'show' : 'shows'} (practice, not counted)
				</p>
			{/if}
			<p class="stat"><strong>+{sessionXp}</strong> XP this session</p>
			<ul class="breakdown" aria-label="XP by card type">
				{#each STUDY_KINDS as kind (kind)}
					{#if kindXp[kind] > 0}
						<li>{KIND_LABELS[kind]} <strong>+{kindXp[kind]}</strong></li>
					{/if}
				{/each}
				{#if dailyBonusXp > 0}
					<li>Daily bonus <strong>+{dailyBonusXp}</strong></li>
				{/if}
			</ul>
			<p class="stat">Level <strong>{progress.level}</strong></p>
			<div
				class="bar"
				role="progressbar"
				aria-label="Progress to the next level"
				aria-valuemin="0"
				aria-valuemax={progress.xpForNext}
				aria-valuenow={progress.xpInto}
			>
				<span style:width={`${(progress.xpInto / progress.xpForNext) * 100}%`}></span>
			</div>
			<p class="hint">{progress.xpInto} / {progress.xpForNext} XP to level {progress.level + 1}</p>
			<p class="stat">
				<span aria-hidden="true">🔥</span> Streak <strong>{streak.current}</strong>
				{streak.current === 1 ? 'day' : 'days'}
			</p>
			<Mascot
				level={progress.level}
				streak={streak.current}
				todayDone={streak.todayDone}
				size={72}
			/>
			<a href="/study">Back to study setup</a>
		</section>
	{:else}
		<header class="top">
			<h1>Study</h1>
			<p class="progress" aria-live="polite">
					{queueProgress.position} / {queueProgress.total}{#if queueProgress.pending > 0}, {queueProgress.pending}
						to repeat{/if}
				</p>
			<a href="/study">End session</a>
		</header>

		{#if entryError}
			<section class="state">
				<p class="error" role="alert">{entryError}</p>
				<button type="button" onclick={retryEntry}>Retry</button>
			</section>
		{:else if resolved === null}
			<p class="hint" role="status">Loading card…</p>
		{:else}
			{@const current = resolved}
			<article class="card" aria-label={`${KIND_LABELS[current.item.kind]} card`}>
				<p class="badges">
					<span class="badge kind-{current.item.kind}">{KIND_LABELS[current.item.kind]}</span>
					{#if current.item.kind === 'sentence'}
						<span class="badge">{TIER_LABELS[current.tier]}</span>
					{/if}
					{#if current.item.reshow !== undefined}
						<span class="badge badge-again"
							>Again, look {current.item.reshow + 1} of {MAX_RESHOWS + 1}</span
						>
					{/if}
					{#if current.item.virtual && current.item.kind !== 'vocab'}
						<span class="badge">new</span>
					{/if}
				</p>

				{#key index}
					{#if current.item.kind === 'vocab'}
						<VocabCard
							item={current.item}
							entry={current.entry}
							revealed={done}
							onDone={onCardDone}
							audio={currentAudio ?? undefined}
						/>
					{:else if current.item.kind === 'sentence' && current.sentence !== null}
						<SentenceCard
							item={current.item}
							entry={current.entry}
							sentence={current.sentence}
							tier={current.tier}
							seed={current.seed}
							language={sessionLanguage || current.entry.language}
							{done}
							onDone={onCardDone}
						/>
					{:else if current.item.kind === 'writing'}
						<WritingCard
							item={current.item}
							entry={current.entry}
							chars={current.chars}
							{done}
							onDone={onCardDone}
						/>
					{:else if current.item.kind === 'tone'}
						<ToneCard
							item={current.item}
							entry={current.entry}
							{done}
							onDone={onCardDone}
							audio={currentAudio ?? undefined}
						/>
					{/if}
				{/key}

				{#if gradeError}
					<p class="error" role="alert">{gradeError}</p>
				{/if}

				<div class="grades" role="group" aria-label="Grade this card">
					{#each GRADE_LABELS as option (option.grade)}
						<button
							type="button"
							class="grade grade-{option.grade}"
							class:suggested={done && suggested === option.grade}
							bind:this={gradeButtons[option.grade - 1]}
							disabled={!done || grading}
							title={`Press ${option.grade}`}
							aria-label={done && suggested === option.grade
								? `${option.label} (suggested), key ${option.grade}`
								: `${option.label}, key ${option.grade}`}
							onclick={(event) =>
								// detail 0: activated from the keyboard, not a pointer.
								void submitGrade(option.grade, event.detail === 0 ? 'activation' : 'click')}
						>
							{option.label}
							{#if done && suggested === option.grade}
								<span class="suggested-tag" aria-hidden="true">suggested</span>
							{/if}
						</button>
					{/each}
				</div>
				<p class="keys">{KEY_HINTS[current.item.kind]}{#if done && currentAudio !== null} · P plays{/if}</p>
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

	h1 {
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

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0 0 0.9rem;
	}

	.badge {
		font-size: 0.75rem;
		font-weight: 600;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 999px;
		padding: 0.05rem 0.55rem;
		opacity: 0.85;
	}

	.badge.badge-again {
		border-color: #c62828;
		color: #c62828;
		opacity: 1;
	}

	@media (prefers-color-scheme: dark) {
		.badge.badge-again {
			border-color: #ff8a80;
			color: #ff8a80;
		}
	}

	.badge.kind-sentence {
		border-color: #6a1b9a;
	}

	.badge.kind-writing {
		border-color: #ef8f00;
	}

	.badge.kind-tone {
		border-color: #2e7d32;
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
		display: grid;
		justify-items: center;
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

	.grades button.suggested {
		border-width: 2px;
		border-color: #0b6bcb;
		background: color-mix(in srgb, #0b6bcb 14%, transparent);
	}

	.grades button:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.suggested-tag {
		font-size: 0.7rem;
		font-weight: 500;
		opacity: 0.8;
	}

	.session button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.keys {
		margin: 0.75rem 0 0;
		font-size: 0.85rem;
		opacity: 0.7;
	}

	.stat {
		margin: 0.4rem 0;
		font-size: 1.1rem;
	}

	.breakdown {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin: 0 0 0.6rem;
		padding: 0;
		list-style: none;
		font-size: 0.9rem;
		opacity: 0.85;
	}

	.bar {
		height: 0.5rem;
		max-width: 20rem;
		border-radius: 999px;
		background: color-mix(in srgb, currentColor 15%, transparent);
		overflow: hidden;
	}

	.bar span {
		display: block;
		height: 100%;
		background: #0b6bcb;
	}
</style>
