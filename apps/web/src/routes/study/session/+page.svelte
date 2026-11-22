<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolveAudio, type AudioResolution } from '$lib/api/audio';
	import { getEntry } from '$lib/api/entries';
	import { segmentBatch } from '$lib/api/segment';
	import { token } from '$lib/auth';
	import { activate, canSound, headwordClips } from '$lib/audio/button';
	import { withShownWritten } from '$lib/study/cardView';
	import { readAudioSettings } from '$lib/audio/settings';
	import { getPlayer } from '$lib/audio/shared';
	import { autoplayDue, cardAudio, isPlayKey, preloadClips } from '$lib/study/audioCue';
	import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
	import { ApiError } from '$lib/api/client';
	import type { Entry, EntryBase, SegmentMatch, Sentence } from '$lib/api/types';
	import ClozeCard from '$lib/features/flashcards/cards/ClozeCard.svelte';
	import ReverseCard from '$lib/features/flashcards/cards/ReverseCard.svelte';
	import SentenceCard from '$lib/features/flashcards/cards/SentenceCard.svelte';
	import ToneCard from '$lib/features/flashcards/cards/ToneCard.svelte';
	import VocabCard from '$lib/features/flashcards/cards/VocabCard.svelte';
	import WritingCard from '$lib/features/flashcards/cards/WritingCard.svelte';
	import {
		backfillLimit,
		buryAfterAnswer,
		cardedSentenceIds,
		clozeDistractorPool,
		deckSessionPlan,
		dropItem,
		isEligible,
		levelSessionItems,
		rememberDrop,
		resolveSentence,
		revealsOnKey,
		reviewCountFor,
		shouldIgnoreGrade,
		tierForCard,
		type CardResult,
		type FlowItem
	} from '$lib/study/cardFlow';
	import { flushPendingReviews, recordReplacement, recordReview } from '$lib/study/events';
	import {
		backFrom,
		pushStep,
		regradeAction,
		regradeQueue,
		replaceSessionReview,
		type GradedStep
	} from '$lib/study/regrade';
	import { ineligibleKey, loadIneligible, rememberIneligible } from '$lib/study/ineligible';
	import {
		acceptedClozeAnswers,
		clozeCandidates,
		clozeMode,
		pickDistractors,
		resolveClozeShowing,
		type ClozeMode,
		type ClozePrompt
	} from '$lib/study/cloze';
	import { buriedLevelEntries, buriedNow } from '$lib/study/siblings';
import { contextForData } from '$lib/study/currentContext';
import { IDENTITY_CLOCK, type StudyClock } from '$lib/study/studyClock';
import type { Run } from '$lib/study/vacation';
	import { dailyStreak, levelProgress, xpByKind, xpFromReviews } from '$lib/study/exp';
	import { currentStudyDay, onStudyDayChange } from '$lib/time/zone';
	import Mascot from '$lib/features/flashcards/Mascot.svelte';
	import { gradeItem } from '$lib/study/grade';
	import { DEFAULT_W } from '$lib/study/fsrs/params';
	import { buildLevelPlan, type LevelUnit } from '$lib/study/levelQueue';
	import { MAX_RESHOWS, applyGrade, progressOf, removeAt } from '$lib/study/requeue';
	import { SESSION_CONFIG_KEY, STUDY_ALL_LIMIT, loadConfig } from '$lib/study/session';
	import { companionNote, sessionStartError, showCompanionNote } from '$lib/study/sessionStart';
	import { offline } from '$lib/pwa/offlineState';
	import { activeWeights, addCard, loadStudyData } from '$lib/study/store';
	import { getFrequencyPacks } from '$lib/api/frequency';
	import { loadRanks } from '$lib/study/frequencyRanks';
	import { loadLevelKeys } from '$lib/study/levelKeys';
	import { sessionNewOrder, sessionSeedOf, sessionTypeOrder } from '$lib/study/session';
	import { candidateNewEntries, deckOrdersOf, sessionNewKey } from '$lib/study/sessionOrder';
	import { mixFlowQueue } from '$lib/study/sessionMix';
	import {
		CARD_KINDS,
		type ReviewEvent,
		type ReviewGrade,
		type ReviewMeta,
		type StudyCard,
		type StudyCardKind
	} from '$lib/study/types';
	import { shuffleTokens, type SaladTier } from '$lib/study/wordSalad';
	import { usableChars } from '$lib/study/writing';
	import { hasStrokeData } from '$lib/study/strokeIndex';
	import { newUlid } from '$lib/ulid';
	import { workspaces } from '$lib/workspaces';
	import NoteAnswer from '$lib/notes/NoteAnswer.svelte';
	import { loadNoteCfg, loadNotes } from '$lib/notes/store';
	import StudyFace from '$lib/features/flashcards/face/StudyFace.svelte';
	import GradeBar from '$lib/features/flashcards/face/GradeBar.svelte';
	import { provideCardFace } from '$lib/features/flashcards/face/cardFace.svelte';
	import { KIND_TASK_LABELS } from '$lib/features/flashcards/face/kinds';
	import { nextIntervals } from '$lib/study/scheduler';
	import { longInterval } from '$lib/study/intervalText';
	import { formatNumber } from '$lib/i18n/format';
	import Button from '$lib/ui/Button.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Section from '$lib/ui/Section.svelte';
	import Stat from '$lib/ui/Stat.svelte';

	const GRADE_KEYS: Record<string, ReviewGrade> = { '1': 1, '2': 2, '3': 3, '4': 4 };
	const GRADE_NAMES: Record<ReviewGrade, string> = {
		1: t('study.grade.again'),
		2: t('study.grade.hard'),
		3: t('study.grade.good'),
		4: t('study.grade.easy')
	};

	// The open page (#101): the card registers its primary action here.
	provideCardFace();

	const KIND_LABELS: Record<StudyCardKind, string> = {
		vocab: t('study.cardType.vocab'),
		sentence: t('study.cardType.sentence'),
		writing: t('study.cardType.writing'),
		tone: t('study.cardType.tone'),
		reverse: t('study.cardType.reverse'),
		cloze: t('study.cardType.cloze')
	};

	const STUDY_KINDS: readonly StudyCardKind[] = CARD_KINDS;

	const TIER_LABELS: Record<SaladTier, string> = {
		0: t('study.session.tier0'),
		1: t('study.session.tier1'),
		2: t('study.session.tier2')
	};

	// The key map per kind, shown under the grade buttons.
	const KEY_HINTS: Record<StudyCardKind, string> = {
		vocab: t('study.session.keys.vocab'),
		sentence: t('study.session.keys.sentence'),
		writing: t('study.session.keys.writing'),
		tone: t('study.session.keys.tone'),
		reverse: t('study.session.keys.reverse'),
		cloze: t('study.session.keys.cloze')
	};

	// The SPA has no SSR, so the tab's setup is readable during init.
	const config = loadConfig();
	// The shuffle's seed lives in the saved setup, so a reload of the same
	// session keeps its order; a setup without one gets a seed drawn once
	// per tab (sessionSeedOf), never a new one per load.
	const sessionSeed = sessionSeedOf(config);
	const kinds: StudyCardKind[] = CARD_KINDS.filter((kind) => config.cardTypes.includes(kind));
	// The order of card types (#132): the same seed, so a reload keeps the mix.
	// Deck sessions show a new word's Recognise card before its other types;
	// a character level gates writing itself.
	const mixOptions = {
		seed: sessionSeed,
		order: sessionTypeOrder(config),
		vocabFirst: config.mode === 'decks'
	};

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
		/** Cloze: the shown sentence, its prompt, answer mode, choices and accepted answers. */
		cloze?: {
			sentence: Sentence;
			prompt: ClozePrompt;
			mode: ClozeMode;
			choices: string[];
			accepted: Set<string>;
		};
	}

	/**
	 * A levels session belongs to the workspace language it was set up
	 * in. The scheme list is global, so the saved id/level must be
	 * re-validated against the current workspace: a mid-session switch
	 * to another language must abort instead of studying (or writing)
	 * cards in the wrong workspace.
	 */
	class LevelWorkspaceMismatch extends Error {}

	/** The configured level's entries and the unit of its scheme. */
	interface LevelRequest {
		entries: EntryBase[];
		unit: LevelUnit;
	}

	/** levelEntriesRequest loads the configured level, or nothing in decks mode. */
	async function levelEntriesRequest(language: string | null): Promise<LevelRequest> {
		if (config.mode !== 'levels') return { entries: [], unit: 'word' };
		if (config.schemeId === null || config.levelName === null) {
			return Promise.reject(new Error('This level session is missing its scheme or level.'));
		}

		const schemes = await getSchemes();
		const scheme = schemes.find(
			(candidate) => candidate.id === config.schemeId && candidate.language === language
		);
		if (scheme !== undefined && config.levelName !== null) {
			sessionLevel = t('study.session.levelName', { scheme: scheme.name, level: config.levelName });
		}
		if (scheme === undefined) {
			throw new LevelWorkspaceMismatch(
				t('study.session.schemeMissing')
			);
		}
		if (!scheme.levels.some((level) => level.name === config.levelName)) {
			throw new LevelWorkspaceMismatch(
				t('study.session.levelGone', { level: config.levelName ?? '', scheme: scheme.name })
			);
		}
		return {
			entries: await getSchemeEntries(config.schemeId, config.levelName),
			unit: scheme.unit === 'character' ? 'character' : 'word'
		};
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
	// True when this session was planned from saved data (no companion cards).
	let offlineSession = $state(false);
	// Why the new cards keep the order added (#75): mixed decks, no pack, offline.
	let orderNote = $state('');
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
	// The study clock of the session's workspace (set when the session loads).
	let sessionClock = $state.raw<StudyClock>(IDENTITY_CLOCK);
	let sessionVacation = $state.raw<readonly Run[]>([]);
	let sessionReviews = $state.raw<ReviewEvent[]>([]);
	// Back (#131): the graded showings of this session (newest last) and the
	// one shown again, if any (an index into `steps`; null: the current card).
	let steps = $state.raw<GradedStep<Resolved>[]>([]);
	let backAt = $state<number | null>(null);
	let index = $state(0);
	// Re-shows answered this session; practice only, never recorded.
	let reshown = $state(0);
	// Said once a graded answer buried related cards; cleared by the next grade.
	let buryNote = $state('');
	// Segmenter results per sentence id for this session (cloze blanks).
	let segmentCache = new Map<number, Promise<SegmentMatch[]>>();
	let entries = $state.raw<Record<number, Entry>>({});
	// The recordings of every entry in the queue, resolved once per session.
	let audioMap = $state.raw<Record<string, AudioResolution>>({});
	// True once the resolution has finished (found, failed or not needed): autoplay
	// waits for it so a recording that arrives late still plays on its card.
	let audioSettled = $state(false);
	let entryError = $state('');
	let gradeError = $state('');
	// The learner's notes of this workspace (entry id -> text), loaded once per
	// session next to the start and never awaited by it; empty while loading,
	// after a failure, when the workspace switched them off, and offline.
	let sessionNotes = $state.raw<Map<number, string>>(new Map());

	async function loadSessionNotes(workspaceId: number, seq: number): Promise<void> {
		try {
			const [notes, cfg] = await Promise.all([loadNotes(workspaceId), loadNoteCfg(workspaceId)]);
			if (seq === requestSeq && cfg.onAnswer) sessionNotes = notes;
		} catch {
			// Notes are optional help: a failed load shows none.
		}
	}
	let grading = $state(false);
	// The names of the workspace's decks (deck · level on the kind label).
	let deckNames = $state.raw<Map<string, string>>(new Map());
	// A level session's level, as "JLPT kanji N5".
	let sessionLevel = $state('');
	// The polite announcement of the last grade (outside the card, so it survives the next card).
	let gradedMessage = $state('');
	// When the current card was finished: the interval preview's `now`.
	let finishedAt = $state<number | null>(null);
	let faceHeading = $state<HTMLElement>();

	// The card being shown and how far the learner got with it. `done`
	// unlocks the grade buttons; `suggested` is preselected on them.
	let reverseCard = $state<ReverseCard | null>(null);
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
	// The step shown by Back, and what the face shows: that step's card
	// (answer side, the exercise not replayed) or the current card.
	const viewing = $derived(backAt === null ? null : (steps[backAt] ?? null));
	const shownCard = $derived(viewing !== null ? viewing.shown : resolved);
	const shownDone = $derived(viewing !== null || done);
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
	// The learner's day rule; a zone change recomputes XP and the streak.
	let studyDay = $state.raw(currentStudyDay());
	$effect(() => onStudyDayChange((next) => (studyDay = next)));

	const historyXp = $derived(xpFromReviews(reviews, studyDay.dayOf));
	const totalXp = $derived(xpFromReviews([...reviews, ...sessionReviews], studyDay.dayOf));
	const sessionXp = $derived(totalXp - historyXp);
	const progress = $derived(levelProgress(totalXp));
	const streak = $derived(dailyStreak([...reviews, ...sessionReviews], Date.now(), studyDay, sessionVacation));
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
			entryError = message(err, t('study.session.wordFailed'));
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
		steps = [];
		backAt = null;
		index = 0;
		reshown = 0;
		buryNote = '';
		orderNote = '';
		segmentCache = new Map();
		entries = {};
		audioMap = {};
		audioSettled = false;
		entryError = '';
		gradeError = '';
		grading = false;
		pendingEntryId = null;

		sessionNotes = new Map();
		deckNames = new Map();
		sessionLevel = '';
		gradedMessage = '';
		if (workspaceId === null) {
			noWorkspace = true;
			loading = false;
			return;
		}
		if ($offline.online) void loadSessionNotes(workspaceId, seq);

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
			const [data, levelRequest] = await Promise.all([
				loadStudyData(workspaceId),
				levelEntriesRequest(language)
			]);
			if (seq !== requestSeq) return;

			// Offline (or answered from the saved copy): real cards only, see planCompanions.
			offlineSession = !$offline.online || $offline.servedFromCacheAt !== null;
			const history = data.reviews;
			reviews = history;
			weights = activeWeights(data);
			const loaded = contextForData(data, workspaceId);
			sessionClock = loaded.clock;
			sessionVacation = loaded.vacation;
			const w = weights;
			cards = data.cards;
			deckNames = new Map(data.decks.map((deck) => [deck.id, deck.name]));
			const now = new Date();
			// The order of new cards (#75): ranks or level keys only for entries
			// that can be new; offline or on failure the order added, with a note.
			const order = await sessionNewKey(
				{
					mode: config.mode,
					order: sessionNewOrder(config),
					language: language ?? '',
					deckOrders: deckOrdersOf(config.deckIds, data.decks, data.deckSettings),
					levelUnit: levelRequest.unit,
					newEntryIds:
						config.mode === 'levels'
							? candidateNewEntries({
									cards: data.cards,
									reviews: history,
									entries: levelRequest.entries.map((entry) => entry.id),
									kinds
								})
							: candidateNewEntries({ cards: data.cards, reviews: history, deckIds: config.deckIds }),
					online: !offlineSession,
					seed: sessionSeed
				},
				{ packs: getFrequencyPacks, schemes: getSchemes, ranks: loadRanks, levelKeys: loadLevelKeys }
			);
			if (seq !== requestSeq) return;
			orderNote = order.note ?? '';
			const keyOf = order.key;
			if (config.mode === 'levels') {
				// Character levels study recognition and writing; word levels vocab
				// only. Companions are deck-only. A dropped virtual item (no stroke
				// data) is replaced from the reserve, as in a deck session.
				// A word answered today through reverse or cloze is buried: left out
				// before the limits, so the next word takes its slot.
				const ctx = contextForData(data, workspaceId);
				const day = ctx.day;
				const buried = buriedNow({ cards: data.cards, reviews: history, now, studyDay: day });
				const plan = buildLevelPlan({
					entries: levelRequest.entries,
					cards: data.cards,
					reviews: history,
					newLimit: config.newLimit,
					reviewLimit: config.reviewLimit,
					now,
					w,
					unit: levelRequest.unit,
					kinds,
					ctx,
					hasStrokes: hasStrokeData,
					skip: loadIneligible(workspaceId),
					excludeEntries: buriedLevelEntries(buried, data.cards),
					newKey: keyOf ?? undefined,
					studyAll: config.studyAll === true
				});
				// The order of card types (#132): due first, kinds interleaved.
				queue = mixFlowQueue(levelSessionItems(plan.queue, data.cards, kinds, buried), history, mixOptions);
				reserve = levelSessionItems(plan.reserve, data.cards, kinds, buried);
				backfillLeft = config.studyAll === true ? STUDY_ALL_LIMIT : backfillLimit(config.newLimit);
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
					ctx: contextForData(data, workspaceId),
					deckSettings: data.deckSettings,
					offline: offlineSession,
					language: language ?? '',
					// Words this tab already found unsuitable are not fetched again.
					skip: loadIneligible(workspaceId),
					newKey: keyOf === null ? undefined : (card) => keyOf(card.entryId),
					studyAll: config.studyAll === true
				});
				queue = mixFlowQueue(plan.queue, history, mixOptions);
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
				loadError = sessionStartError({
					offline: !$offline.online || err instanceof TypeError,
					mode: config.mode,
					fallback: message(err, t('study.session.startFailed'))
				});
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
		// Every face shows the card's kana snapshot when it is a reading (a
		// starter deck's kana row), like the deck list.
		entry = withShownWritten(entry, item.card?.written ?? item.written);
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
					tier: item.tier ?? tierForCard(cardId, history, now, weights, sessionClock),
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
			case 'reverse':
				return isEligible('reverse', entry, { language, hasSentence: false }) ? base : null;
			case 'cloze':
				return resolveCloze(item, entry, language, history, now, base);
			default:
				return null;
		}
	}

	/** segmentOf caches one sentence's segmenter matches for the session. */
	function segmentOf(language: string, sentence: Sentence): Promise<SegmentMatch[]> {
		let found = segmentCache.get(sentence.id);
		if (found === undefined) {
			found = segmentBatch(language, sentence.hanzi);
			// A failed request is not cached: the next showing asks again.
			found.catch(() => segmentCache.delete(sentence.id));
			segmentCache.set(sentence.id, found);
		}
		return found;
	}

	/**
	 * resolveCloze picks the sentence and blanks of a cloze showing. A failed
	 * segment request rejects: the item is dropped without being remembered
	 * as ineligible (the word is checked again next session).
	 */
	async function resolveCloze(
		item: FlowItem,
		entry: Entry,
		language: string,
		history: readonly ReviewEvent[],
		now: Date,
		base: Resolved
	): Promise<Resolved | null> {
		const candidates = clozeCandidates(entry.sentences);
		const matches = new Map<number, SegmentMatch[]>();
		await Promise.all(
			candidates.map(async (sentence) => {
				matches.set(sentence.id, await segmentOf(language, sentence));
			})
		);
		const cardId = item.virtual ? null : item.cardId;
		const recorded = reviewCountFor(cardId, history);
		const showing = resolveClozeShowing({
			entry,
			sentences: entry.sentences,
			matchesOf: (sentence) => matches.get(sentence.id) ?? [],
			recorded,
			fixedSentenceId: item.clozeSentenceId
		});
		if (!isEligible('cloze', entry, { language, hasSentence: false, hasCloze: showing !== null })) {
			return null;
		}
		if (showing === null) return null;
		const { prompt, sentence } = showing;
		const seed = `${item.card?.id ?? item.cardId}:${recorded}`;
		const forms = [entry.written, ...(entry.forms ?? []).map((form) => form.text)];
		const distractors = pickDistractors({
			answer: prompt.answer,
			sentence: sentence.hanzi,
			candidates: clozeDistractorPool(cards, config.deckIds, item.entryId),
			seed
		});
		const mode =
			item.clozeMode ??
			clozeMode({
				tier: tierForCard(cardId, history, now, weights, sessionClock),
				answer: prompt.answer,
				entryForms: forms,
				distractors
			});
		return {
			...base,
			item: { ...item, clozeSentenceId: sentence.id, clozeMode: mode },
			seed,
			cloze: {
				sentence,
				prompt,
				mode,
				choices: mode === 'choose' ? shuffleTokens([prompt.answer, ...distractors], seed) : [],
				accepted: acceptedClozeAnswers(prompt.answer, entry)
			}
		};
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
			rememberDrop(item, item.written ?? entry.written, entry)
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
		const ids = [...queue, ...reserve].filter(hasWordAudio).map((i) => i.entryId);
		if (!$token || ids.length === 0) {
			audioSettled = true;
			return;
		}
		void resolveAudio(ids).then((found) => {
			if (seq !== requestSeq) return;
			audioMap = found;
			audioSettled = true;
		});
	}

	// Vocab, tone and reverse cards pronounce their word (reverse only after the reveal).
	function hasWordAudio(item: FlowItem): boolean {
		return item.kind === 'vocab' || item.kind === 'tone' || item.kind === 'reverse';
	}

	const audioSettings = $derived(readAudioSettings($workspaces.current?.settings));
	const currentAudio = $derived(
		shownCard !== null && hasWordAudio(shownCard.item)
			? cardAudio(shownCard.entry, audioMap[String(shownCard.item.entryId)], audioSettings)
			: null
	);
	let autoplayedFor: string | null = null;

	function playCurrent(): void {
		if (!canSound(currentAudio) || currentAudio === null) return;
		void activate(getPlayer(), currentAudio, currentAudio.lang).catch(() => {});
	}

	// Autoplay: once per card, right after the reveal, only when the workspace
	// setting is on (it is off by default).
	$effect(() => {
		const key = resolved === null ? '' : `${index}:${resolved.item.cardId}`;
		const due = autoplayDue({
			done,
			autoplay: audioSettings.autoplay,
			ready: audioSettled,
			playedFor: autoplayedFor,
			key
		});
		if (!due || key === '') return;
		// Decided: it plays now (the recordings are in), or there is nothing to play.
		autoplayedFor = key;
		untrack(playCurrent);
	});

	// Warm the next card's recording while this one is on screen.
	$effect(() => {
		const next = queue[index + 1];
		const res = next === undefined ? undefined : audioMap[String(next.entryId)];
		if (res !== undefined && next !== undefined && hasWordAudio(next)) {
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
			finishedAt = null;
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


	/**
	 * The next interval of each grade (#101): the same replay, weights and
	 * study clock as the grade itself, at the moment the card was finished.
	 * A re-show is practice (never recorded): no interval.
	 */
	const intervals = $derived.by((): Record<ReviewGrade, number> | null => {
		if (!done || resolved === null || finishedAt === null || resolved.item.reshow !== undefined) return null;
		const item = resolved.item;
		return nextIntervals(
			item.virtual ? null : item.cardId,
			[...reviews, ...sessionReviews],
			new Date(finishedAt),
			weights,
			sessionClock
		);
	});

	/**
	 * The intervals of a step shown by Back: the same preview, from the
	 * history without the step's own review, at the moment it was finished.
	 * A practice step (a re-show) has none.
	 */
	const backIntervals = $derived.by((): Record<ReviewGrade, number> | null => {
		if (viewing === null || viewing.review === null) return null;
		const own = viewing.review.id;
		return nextIntervals(
			viewing.item.cardId,
			[...reviews, ...sessionReviews.filter((review) => review.id !== own)],
			new Date(viewing.finishedAt),
			weights,
			sessionClock
		);
	});

	/** goBack shows the card graded before the one shown (Back, key Z). */
	async function goBack(): Promise<void> {
		if (grading) return;
		const at = backFrom(steps.length, backAt);
		if (at === null) return;
		backAt = at;
		await tick();
		faceHeading?.focus();
	}

	/** leaveBack returns to the current card without a change (Return, Escape). */
	async function leaveBack(): Promise<void> {
		if (backAt === null) return;
		backAt = null;
		await tick();
		faceHeading?.focus();
	}

	/**
	 * regrade changes the grade of the step shown by Back: the same grade
	 * changes nothing; a recorded step gets a replacing review (the outbox
	 * keeps it on failure), a practice step only its queue effect; both
	 * undo the old grade's re-show and apply the new one (regradeQueue).
	 * Then the current card is shown again.
	 */
	async function regrade(value: ReviewGrade): Promise<void> {
		const at = backAt;
		const workspaceId = sessionWorkspaceId;
		if (at === null || grading || workspaceId === null) return;
		const step = steps[at];
		if (step === undefined) return;
		const action = regradeAction(step, value);
		if (action === 'none') {
			await leaveBack();
			return;
		}
		const shownIntervals = backIntervals;
		grading = true;
		try {
			let review = step.review;
			if (action === 'replace' && review !== null) {
				const next = await recordReplacement(review, value);
				if (sessionWorkspaceId !== workspaceId) return;
				// Not kept (its workspace was deleted): the notice said so.
				if (next === null) return;
				sessionReviews = replaceSessionReview(sessionReviews, review.id, next);
				review = next;
			}
			queue = regradeQueue(queue, index, step, value);
			steps = steps.map((other, i) => (i === at ? { ...other, grade: value, review } : other));
			gradedMessage =
				shownIntervals === null
					? t('study.session.regrade.changedPractice', { grade: GRADE_NAMES[value] })
					: t('study.session.regrade.changed', { grade: GRADE_NAMES[value], when: longInterval(shownIntervals[value]) });
			backAt = null;
			ensureEntry(queue[index]);
			await tick();
			faceHeading?.focus();
		} finally {
			grading = false;
		}
	}

	/** deckLevelText: the card's first deck (General for general) and the level, "General · JLPT kanji N5". */
	function deckLevelText(item: FlowItem): string | null {
		const deckId = (item.card?.deckIds ?? item.deckIds ?? [])[0];
		const deck =
			deckId === undefined ? '' : deckId === 'general' ? t('flashcards.deck.general') : (deckNames.get(deckId) ?? '');
		const entry = entries[item.entryId];
		const badge = entry?.badges?.[0];
		const level =
			sessionLevel ||
			(badge === undefined ? '' : t('study.session.levelName', { scheme: badge.schemeName, level: badge.levelName }));
		if (deck && level) return t('study.session.deckLevel', { deck, level });
		return deck || level || null;
	}

	/** onCardDone unlocks grading and preselects the card's suggestion. */
	async function onCardDone(result: CardResult): Promise<void> {
		if (resolved === null || done) return;
		finishedAt = Date.now();
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

	// The card face's onDone: the current card finishes; a card shown by Back is already done.
	const onCardShown = (result: CardResult): Promise<void> => onCardDone(result);
	const noop = (): void => {};

	/** withBackKey adds "Z goes back" to the key line once something was graded. */
	function withBackKey(keys: string): string {
		return steps.length > 0 ? t('study.session.regrade.keysWithBack', { keys }) : keys;
	}

	function revealByKey(): void {
		if (resolved === null || !revealsOnKey(resolved.item.kind)) return;
		// A reverse card finishes through its own path, so what was typed and the
		// shown reading count (suggestion and hint) like the Show answer button.
		if (resolved.item.kind === 'reverse' && reverseCard !== null) {
			reverseCard.finish();
			return;
		}
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
		const shownIntervals = intervals;

		gradeError = '';
		grading = true;
		try {
			const step = await applyGrade({
				queue,
				index,
				grade: value,
				tier: current.tier,
				cloze:
					item.kind === 'cloze' && item.clozeSentenceId !== undefined && item.clozeMode !== undefined
						? { sentenceId: item.clozeSentenceId, mode: item.clozeMode }
						: undefined,
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
			let recorded: ReviewEvent | null = null;
			if (result === null) {
				// A re-show is practice: no review event, so FSRS, XP, streak and
				// the log count the card once.
				reshown += 1;
			} else {
				// addCard may hand back a card this page already holds.
				if (result.created && !cards.some((card) => card.id === result.card.id)) {
					cards = [...cards, result.card];
				}
				// The recorded event itself, so Back can name it (#131).
				recorded = result.review ?? sessionReview(result.card, value, workspaceId, item.kind, meta);
				sessionReviews = [...sessionReviews, recorded];
			}
			const gradedItem =
				result === null ? item : { ...item, cardId: result.card.id, virtual: false, card: result.card };
			steps = pushStep(steps, {
				pos: index,
				item: gradedItem,
				grade: value,
				suggested,
				finishedAt: finishedAt ?? Date.now(),
				review: recorded,
				tier: current.tier,
				shown: { ...current, item: gradedItem }
			});
			gradedMessage =
				shownIntervals === null
					? t('study.session.gradedPractice', { grade: GRADE_NAMES[value] })
					: t('study.session.graded', { grade: GRADE_NAMES[value], when: longInterval(shownIntervals[value]) });
			// The grade bar goes with the card; the next card's heading takes the
			// focus (below), so Space/Enter keep reaching the window.
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			buryNote = '';
			if (result !== null) {
				// The answer may bury the word's other cards until tomorrow.
				const next = buryAfterAnswer({ queue: step.queue, reserve, backfillLeft }, index, {
					kind: item.kind,
					entryId: item.entryId,
					cardId: item.cardId
				});
				if (next.buried > 0) {
					buryNote = t('study.session.buried', { count: next.buried });
				}
				queue = next.plan.queue;
				reserve = next.plan.reserve;
				backfillLeft = next.plan.backfillLeft;
			} else {
				queue = step.queue;
			}
			index = step.index;
			ensureEntry(queue[index]);
			// Screen readers hear the new card; keyboard users keep Space/Enter.
			await tick();
			faceHeading?.focus();
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
	 * Key map: vocab and reverse — Space/Enter reveal, then 1–4 grade. Other kinds own
	 * their keys until the learner finishes the card (tone uses 1–5 for
	 * tones), then 1–4 grade. The runner never handles a key before then.
	 */
	function onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.repeat) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		// Back (#131): Z steps back, Escape returns; never into a field or a card's input.
		if (!blocksGradeKeys(event.target)) {
			if ((event.key === 'z' || event.key === 'Z') && steps.length > 0 && !grading) {
				event.preventDefault();
				void goBack();
				return;
			}
			if (event.key === 'Escape' && viewing !== null) {
				event.preventDefault();
				void leaveBack();
				return;
			}
		}
		if (viewing !== null) {
			if (blocksGradeKeys(event.target)) return;
			const value = GRADE_KEYS[event.key];
			if (value !== undefined) {
				event.preventDefault();
				void regrade(value);
			}
			return;
		}
		const current = resolved;
		if (current === null || complete) return;

		if (!done) {
			if (!revealsOnKey(current.item.kind) || isInteractive(event.target)) return;
			if (event.key === ' ' || event.key === 'Enter') {
				event.preventDefault();
				revealByKey();
			}
			return;
		}

		if (blocksGradeKeys(event.target)) return;
		if (isPlayKey(event) && canSound(currentAudio)) {
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
	// Only the workspace is tracked: load() reads the offline state, which the
	// load itself changes (the outbox flush, a cached answer), and a tracked
	// read there reloaded the session for ever in a real browser.
	$effect(() => {
		if (missingConfig) return;
		const workspace = $workspaces.current;
		untrack(() => void load(workspace?.id ?? null, workspace?.language ?? null));
	});
</script>

<svelte:head>
	<title>{pageTitle(t('study.session.title'), t('study.setup.title'))}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="page-body session" class:open={viewing !== null || (currentItem !== undefined && !complete)}>
	{#if missingConfig || workspaceMismatch || loadError || noWorkspace || loading || queue.length === 0}
		<!-- The face and the summary carry their own h1; every state between them keeps the page outline. -->
		<h1 class="visually-hidden">{t('study.session.title')}</h1>
	{/if}
	{#if missingConfig}
		<p class="hint" role="status">{t('study.session.opening')}</p>
	{:else if workspaceMismatch}
		<Section title={t('study.session.unavailable')} level={2}>
			<p class="error" role="alert">{workspaceMismatch}</p>
			<div class="actions"><Button href="/study">{t('study.session.back')}</Button></div>
		</Section>
	{:else if loadError}
		<Section title={t('study.session.unavailable')} level={2}>
			<p class="error" role="alert">{loadError}</p>
			<div class="actions">
				<Button variant="primary" onclick={retryLoad}>{t('study.session.retry')}</Button>
				<Button href="/study">{t('study.session.back')}</Button>
			</div>
		</Section>
	{:else if noWorkspace}
		<Section title={t('study.session.noWorkspace')} level={2}>
			<p class="hint">{t('study.session.noWorkspaceText')}</p>
			<div class="actions"><Button href="/study">{t('study.session.back')}</Button></div>
		</Section>
	{:else if loading}
		<p class="hint" role="status">{t('study.session.loading')}</p>
	{:else if queue.length === 0}
		<Section title={t('study.session.empty')} level={2}>
			<p class="hint">{t('study.session.emptyText')}</p>
			<div class="actions"><Button href="/study">{t('study.session.back')}</Button></div>
		</Section>
	{:else if complete && viewing === null}
		<h1 class="summary-title">{t('study.session.complete')}</h1>
		<Section>
			<div class="stats">
				<Stat value={formatNumber(sessionReviews.length)} label={t('study.session.reviews', { count: sessionReviews.length })} />
				{#if reshown > 0}
					<Stat value={formatNumber(reshown)} label={t('study.session.reshows', { count: reshown })} />
				{/if}
				<Stat value={t('study.session.xpGained', { xp: formatNumber(sessionXp) })} label={t('study.session.xp')} />
				<Stat value={formatNumber(progress.level)} label={t('study.session.level')} />
			</div>
			<ul class="breakdown" aria-label={t('study.session.xpByType')}>
				{#each STUDY_KINDS as kind (kind)}
					{#if kindXp[kind] > 0}
						<li>{KIND_LABELS[kind]} <strong>+{kindXp[kind]}</strong></li>
					{/if}
				{/each}
				{#if dailyBonusXp > 0}
					<li>{t('study.session.dailyBonus')} <strong>+{dailyBonusXp}</strong></li>
				{/if}
			</ul>
		</Section>
		<Section>
			<div
				class="bar"
				role="progressbar"
				aria-label={t('study.session.progressLabel')}
				aria-valuemin="0"
				aria-valuemax={progress.xpForNext}
				aria-valuenow={progress.xpInto}
			>
				<span style:width={`${(progress.xpInto / progress.xpForNext) * 100}%`}></span>
			</div>
			<p class="hint">
				{t('study.session.xpToLevel', { into: progress.xpInto, next: progress.xpForNext, level: progress.level + 1 })}
			</p>
			<p class="streak">
				<span aria-hidden="true">🔥</span> {t('study.session.streak')} <strong>{streak.current}</strong>
				{t('study.session.streakDays', { count: streak.current })}
			</p>
			<Mascot level={progress.level} streak={streak.current} todayDone={streak.todayDone} size={72} />
			<div class="actions">
				<Button variant="primary" href="/study">{t('study.session.back')}</Button>
				{#if steps.length > 0}
					<Button aria-keyshortcuts="z" onclick={() => void goBack()}>{t('study.session.regrade.summaryBack')}</Button>
				{/if}
			</div>
		</Section>
	{:else if viewing !== null || currentItem !== undefined}
		{@const item = shownCard?.item ?? viewing?.item ?? currentItem!}
		{@const kindLabel = KIND_TASK_LABELS[item.kind]}
		<StudyFace
			{kindLabel}
			deckLevel={deckLevelText(item)}
			cardLabel={t('study.session.cardLabel', { kind: kindLabel })}
			headingLabel={t('study.session.cardHeading', {
				kind: kindLabel,
				position: queueProgress.position,
				total: queueProgress.total
			})}
			progress={queueProgress}
			countText={queueProgress.pending > 0
				? t('study.session.progressRepeat', {
						position: queueProgress.position,
						total: queueProgress.total,
						count: queueProgress.pending
					})
				: t('study.session.count', { position: queueProgress.position, total: queueProgress.total })}
			done={shownDone && shownCard !== null}
			keys={viewing !== null
				? t('study.session.regrade.keys')
				: withBackKey(
						done && canSound(currentAudio)
							? t('study.session.keysPlays', { keys: KEY_HINTS[item.kind] })
							: KEY_HINTS[item.kind]
					)}
			bind:heading={faceHeading}
		>
			{#snippet chips()}
				{#if viewing !== null}
					<Chip>{t('study.session.regrade.chip', { grade: GRADE_NAMES[viewing.grade] })}</Chip>
				{/if}
				{#if item.kind === 'sentence' && shownCard !== null}
					<Chip>{TIER_LABELS[shownCard.tier]}</Chip>
				{/if}
				{#if item.reshow !== undefined}
					<Chip>{t('study.session.again', { n: item.reshow + 1, max: MAX_RESHOWS + 1 })}</Chip>
				{/if}
				{#if item.virtual && item.kind !== 'vocab'}
					<Chip>{t('study.session.new')}</Chip>
				{/if}
			{/snippet}
			{#snippet note()}
				{#if shownCard !== null}
					<NoteAnswer text={shownDone && !offlineSession ? sessionNotes.get(shownCard.item.entryId) : undefined} />
				{/if}
			{/snippet}
			{#snippet status()}
				{#if gradeError}
					<p class="error" role="alert">{gradeError}</p>
				{/if}
				{#if buryNote}
					<p class="hint" role="status">{buryNote}</p>
				{/if}
				{#if orderNote}
					<p class="hint" role="status">{orderNote}</p>
				{/if}
				{#if showCompanionNote({ offline: offlineSession, kinds })}
					<p class="hint">{companionNote()}</p>
				{/if}
			{/snippet}
			{#snippet grades()}
				{#if viewing !== null}
					<GradeBar
						intervals={backIntervals}
						suggested={viewing.suggested}
						chosen={viewing.grade}
						busy={grading}
						ongrade={(grade) => void regrade(grade)}
					/>
				{:else}
					<GradeBar
						{intervals}
						{suggested}
						busy={grading}
						ongrade={(grade, source) => void submitGrade(grade, source)}
						bind:buttons={gradeButtons}
					/>
				{/if}
			{/snippet}
			{#snippet aux()}
				{#if steps.length > 0}
					<Button
						variant="plain"
						aria-label={t('study.session.regrade.backLabel')}
						aria-keyshortcuts="z"
						disabled={grading || backAt === 0}
						onclick={() => void goBack()}>{t('study.session.regrade.back')}</Button
					>
				{/if}
				{#if viewing !== null}
					<Button variant="plain" aria-keyshortcuts="Escape" onclick={() => void leaveBack()}
						>{t('study.session.regrade.return')}</Button
					>
				{/if}
			{/snippet}

			{#if entryError}
				<div class="card-state">
					<p class="error" role="alert">{entryError}</p>
					<Button onclick={retryEntry}>{t('study.session.retry')}</Button>
				</div>
			{:else if shownCard === null}
				<p class="hint loading-card" role="status">{t('study.session.loadingCard')}</p>
			{:else}
				{@const current = shownCard}
				{@const done = shownDone}
				{@const onCardDone = viewing === null ? onCardShown : noop}
				{#key viewing === null ? index : `back:${backAt}`}
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
						<WritingCard item={current.item} entry={current.entry} chars={current.chars} {done} onDone={onCardDone} />
					{:else if current.item.kind === 'reverse'}
						<ReverseCard
							bind:this={reverseCard}
							item={current.item}
							entry={current.entry}
							revealed={done}
							language={sessionLanguage || current.entry.language}
							onDone={onCardDone}
							audio={currentAudio ?? undefined}
						/>
					{:else if current.item.kind === 'cloze' && current.cloze !== undefined}
						<ClozeCard
							item={current.item}
							entry={current.entry}
							sentence={current.cloze.sentence}
							prompt={current.cloze.prompt}
							mode={current.cloze.mode}
							choices={current.cloze.choices}
							accepted={current.cloze.accepted}
							language={sessionLanguage || current.entry.language}
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
			{/if}
		</StudyFace>
	{/if}
	<!-- Always present: each grade is announced once, after its card has gone. -->
	<p class="graded visually-hidden" role="status" aria-live="polite">{gradedMessage}</p>
</div>

<style>
	.session.open {
		max-width: none;
		padding: 0;
	}

	.summary-title {
		margin: 0 0 var(--space-4);
		font-size: var(--font-size-xl);
		font-weight: var(--weight-strong);
	}

	.hint {
		margin: 0;
		color: var(--readable-muted);
	}

	.loading-card {
		text-align: center;
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		font-weight: var(--weight-strong);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.card-state {
		display: grid;
		gap: var(--space-3);
		justify-items: start;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4) var(--space-6);
	}

	.breakdown {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.breakdown strong {
		color: var(--text);
		font-weight: var(--weight-medium);
	}

	.bar {
		height: 3px;
		max-width: 20rem;
		margin-bottom: var(--space-2);
		border-radius: 3px;
		background: var(--raised);
		overflow: hidden;
	}

	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.streak {
		margin: var(--space-3) 0;
	}

	@media (forced-colors: active) {
		.bar {
			outline: 1px solid CanvasText;
		}
		.bar span {
			forced-color-adjust: none;
			background: Highlight;
		}
	}
</style>
