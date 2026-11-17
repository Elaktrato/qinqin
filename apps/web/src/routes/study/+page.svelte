<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { ApiError } from '$lib/api/client';
	import { fetchSchemeCharacters, getSchemeEntries, getSchemes } from '$lib/api/schemes';
	import { fetchCharacters } from '$lib/api/characters';
	import type { CharRow } from '$lib/api/types';
	import type { SchemeLevelMembers } from '$lib/study/charGroups';
	import { levelMastery } from '$lib/study/levelMastery';
	import type { EntryBase, Level, Scheme } from '$lib/api/types';
	import { usesHan } from '$lib/languages';
	import CardManager from '$lib/components/CardManager.svelte';
	import { workspaces } from '$lib/workspaces';
	import { deckSessionItems, isChinese, sessionCounts } from '$lib/study/cardFlow';
	import { loadIneligible } from '$lib/study/ineligible';
	import {
		defaultExtraTypes,
		hasTabSetup,
		loadExtraChoices,
		loadRememberedTypes,
		rememberCardTypes,
		rememberExtraChoice,
		type ExtraChoices
	} from '$lib/study/cardTypesMemory';
	import DeckCardTypes from '$lib/study/DeckCardTypes.svelte';
	import { enabledKinds, type DeckSettings } from '$lib/study/deckSettings';
	import { buriedLevelEntries, buriedNow } from '$lib/study/siblings';
	import { DEFAULT_W } from '$lib/study/fsrs/params';
	import {
		levelEntryCount,
		levelPlanCounts,
		levelTypeWarnings,
		levelUsable,
		type LevelUnit
	} from '$lib/study/levelQueue';
import { contextForData, currentContext, onContextStale } from '$lib/study/currentContext';
import type { StudyContext } from '$lib/study/studyContext';
import type { VacationPeriod } from '$lib/study/vacation';
import { vacationBanner, vacationStatus } from '$lib/settings/vacationForm';
import { startTodayText } from '$lib/study/limitsText';
import { limitsOf } from '$lib/study/scheduler';
	import { currentStudyDay } from '$lib/time/zone';
	import { hasStrokeData } from '$lib/study/strokeIndex';
	import { getFrequencyPacks } from '$lib/api/frequency';
	import type { FrequencyPack } from '$lib/api/types';
	import { resolveSessionOrder } from '$lib/study/newOrder';
	import { mixedNote, decodeOrder, encodeOrder, sessionOrderChoices } from '$lib/study/newOrderView';
	import { deckOrdersOf } from '$lib/study/sessionOrder';
	import {
		CARD_TYPES,
		loadConfig,
		saveConfig,
		sessionNewOrder,
		validateConfig,
		type StudySessionConfig,
		type StudySessionMode
	} from '$lib/study/session';
	import {
		GENERAL_DECK_ID,
		cardsInDecks,
		createDeck,
		activeWeights,
		deleteDeck,
		loadStudyData,
		renameDeck
	} from '$lib/study/store';
	import {
		CARD_KINDS,
		OPT_IN_KINDS,
		type OptInKind,
		type Deck,
		type ReviewEvent,
		type StudyCard,
		type StudyCardKind
	} from '$lib/study/types';

	function describeScheduling(data: Awaited<ReturnType<typeof loadStudyData>>): string {
		const active = data.fsrs?.active;
		if (active === null || active === undefined) return t('study.setup.schedDefault');
		const day = active.createdAt.slice(0, 10);
		return active.source === 'optimized' ? t('study.setup.schedOptimised', { day }) : t('study.setup.schedImported', { day });
	}

	// Counts only need to distinguish "none" from "some"; the actual
	// session limits are applied by the session page.
	const COUNT_CAP = 999;

	// One line per card type, shown next to its checkbox.
	const TYPE_INFO: Record<StudyCardKind, string> = {
		vocab: t('study.setup.info.vocab'),
		sentence: t('study.setup.info.sentence'),
		writing: t('study.setup.info.writing'),
		tone: t('study.setup.info.tone'),
		reverse: t('study.setup.info.reverse'),
		cloze: t('study.setup.info.cloze')
	};

	// Restore this tab's setup before the first render: on an SPA the
	// component never runs during SSR, so sessionStorage is available.
	const saved = loadConfig();

	let decks = $state<Deck[]>([]);
	let cards = $state<StudyCard[]>([]);
	let reviews = $state<ReviewEvent[]>([]);
	let weights = $state.raw<readonly number[]>(DEFAULT_W);
	// Vacation days and the study clock of the active workspace.
	let ctx = $state.raw<StudyContext>(currentContext());
	let vacations = $state.raw<VacationPeriod[]>([]);
	// Per-deck Reverse/Cloze switches (`deckcfg:` rows) and the learner's per-workspace unchecks.
	let deckSettings = $state.raw<Record<string, DeckSettings>>({});
	let extraChoices = $state.raw<ExtraChoices>({});
	let schedulingLabel = $state(t('study.setup.schedDefault'));
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
	// The order of new cards (#75), as a select value; see newOrderView.ts.
	let newOrderValue = $state(encodeOrder(sessionNewOrder(saved)));
	let frequencyPacks = $state.raw<FrequencyPack[]>([]);

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
	// The scheme's characters per level (for "L of N learned"); optional
	// decoration, so a failed load only hides the counts.
	let schemeCharacters = $state.raw<SchemeLevelMembers[]>([]);
	let schemeCharactersSeq = 0;
	// The language's character rows (variants), the Stats map's universe.
	let universeRows = $state.raw<CharRow[]>([]);

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

		// A tab without its own setup starts from the types last started in
		// this workspace (any tab), so opted-in types do not reset to vocab.
		if (workspaceId !== null && !hasTabSetup()) {
			cardTypes = [...(loadRememberedTypes(workspaceId) ?? saved.cardTypes)];
		}
		schemesLoaded = false;
		schemeError = '';
		extraChoices = workspaceId === null ? {} : loadExtraChoices(workspaceId);

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
			// Duplicate cards arrive merged, their reviews re-pointed.
			const data = await loadStudyData(workspaceId);
			if (seq !== requestSeq) return;
			decks = data.decks;
			cards = data.cards;
			reviews = data.reviews;
			deckSettings = data.deckSettings ?? {};
			weights = activeWeights(data);
			ctx = contextForData(data, workspaceId);
			vacations = data.vacations ?? [];
			schedulingLabel = describeScheduling(data);
			selectedDeckIds = keepKnownDecks(selectedDeckIds, data.decks);
		} catch (err) {
			if (seq !== requestSeq) return;
			decks = [];
			cards = [];
			reviews = [];
			loadError = message(err, t('study.setup.decksFailed'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	/**
	 * refreshData re-reads decks, cards and reviews after a card change
	 * without the page-wide loading state, so counts and the queue preview
	 * follow the write.
	 */
	async function refreshData(): Promise<void> {
		if (activeWorkspaceId === null) return;
		const seq = requestSeq;
		try {
			const data = await loadStudyData(activeWorkspaceId);
			if (seq !== requestSeq) return;
			decks = data.decks;
			cards = data.cards;
			reviews = data.reviews;
			deckSettings = data.deckSettings ?? {};
			weights = activeWeights(data);
			ctx = contextForData(data, activeWorkspaceId);
			vacations = data.vacations ?? [];
			schedulingLabel = describeScheduling(data);
		} catch (err) {
			if (seq === requestSeq) deckError = message(err, t('study.setup.reloadFailed'));
		}
	}

	// A new learner day (or zone) changes what is due and on vacation.
	$effect(() => onContextStale(() => void refreshData()));

	async function loadSchemes(seq: number): Promise<void> {
		try {
			const list = await getSchemes();
			if (seq !== requestSeq) return;
			schemes = list;
		} catch (err) {
			if (seq !== requestSeq) return;
			schemes = [];
			schemeError = message(err, t('study.setup.schemesFailed'));
		} finally {
			if (seq === requestSeq) schemesLoaded = true;
		}
	}

	// The installed frequency packs decide whether "most frequent first" is
	// offered; without them the setup shows the hint (nothing is bundled).
	$effect(() => {
		getFrequencyPacks()
			.then((list) => (frequencyPacks = Array.isArray(list) ? list : []))
			.catch(() => (frequencyPacks = []));
	});

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
			levelEntriesError = message(err, t('study.setup.levelFailed'));
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

	$effect(() => {
		const scheme = mode === 'levels' && schemesLoaded ? selectedScheme : null;
		const seq = ++schemeCharactersSeq;
		if (scheme === null) {
			schemeCharacters = [];
			return;
		}
		Promise.all([fetchSchemeCharacters(scheme.id), fetchCharacters(scheme.language)]).then(
			([levels, list]) => {
				if (seq !== schemeCharactersSeq) return;
				schemeCharacters = levels;
				universeRows = list.chars;
			},
			() => {
				if (seq !== schemeCharactersSeq) return;
				schemeCharacters = [];
				universeRows = [];
			}
		);
	});

	const levelLearned = $derived(levelMastery(schemeCharacters, universeRows, cards, reviews, new Date(), weights, ctx.clock));

	function levelOptionLabel(name: string): string {
		const count = levelLearned.get(name);
		return count === undefined || count.total === 0
			? name
			: t('study.setup.levelOption', { level: name, learned: count.learned, total: count.total });
	}

	// Tone needs pinyin, so it is only offered in Chinese workspaces. A
	// hidden type stays in the saved setup (switching back restores it)
	// but never counts or reaches a session.
	// Reverse and cloze are offered only when a selected deck switches them on;
	// they start checked unless the learner unchecked them before in this workspace.
	const enabledOptIn = $derived(enabledKinds(deckSettings, selectedDeckIds));

	const visibleTypes = $derived(
		CARD_TYPES.filter(
			(type) =>
				(type.id !== 'tone' || isChinese(workspaceLanguage ?? '')) &&
				(!isOptIn(type.id) || enabledOptIn.has(type.id as OptInKind))
		)
	);

	function isOptIn(kind: string): boolean {
		return (OPT_IN_KINDS as readonly string[]).includes(kind);
	}

	const extraKinds = $derived(defaultExtraTypes(enabledOptIn, extraChoices));

	const selectedKinds = $derived([
		...CARD_KINDS.filter(
			(kind) =>
				!isOptIn(kind) &&
				cardTypes.includes(kind) &&
				visibleTypes.some((type) => type.id === kind)
		),
		...extraKinds
	]);

	function isChecked(id: string): boolean {
		return isOptIn(id) ? extraKinds.includes(id as OptInKind) : cardTypes.includes(id);
	}

	// Due and new are counted separately so the setup shows what a
	// session would actually contain today, with the selected types and
	// the companion cards a deck session would plan. Cards reviewed but
	// not due yet belong to neither bucket.
	const deckPlan = $derived.by(() => {
		const empty = { due: 0, fresh: 0, byKind: { vocab: 0, sentence: 0, writing: 0, tone: 0, reverse: 0, cloze: 0 } };
		if (selectedDeckIds.length === 0 || selectedKinds.length === 0) return empty;
		const items = deckSessionItems({
			cards,
			reviews,
			deckIds: selectedDeckIds,
			kinds: selectedKinds,
			newLimit: COUNT_CAP,
			reviewLimit: COUNT_CAP,
			now: new Date(),
			w: weights,
			language: workspaceLanguage ?? '',
			deckSettings,
			ctx,
			// Words this tab already found unsuitable are not counted.
			skip: activeWorkspaceId === null ? undefined : loadIneligible(activeWorkspaceId)
		});
		return sessionCounts(items, reviews);
	});

	const deckCounts = $derived({ due: deckPlan.due, fresh: deckPlan.fresh });

	// Planned companions are candidates, not promises: whether a word has
	// a sentence, stroke data or a clean pinyin reading is only known when
	// it comes up, and unsuitable words are skipped then.
	const plannedCompanions = $derived(
		deckPlan.byKind.sentence +
			deckPlan.byKind.writing +
			deckPlan.byKind.tone +
			deckPlan.byKind.reverse +
			deckPlan.byKind.cloze
	);

	// Level sessions never plan reverse or cloze: they do not count towards the
	// level's usable kinds or its "vocab only" warning.
	const levelKinds = $derived(selectedKinds.filter((kind) => !isOptIn(kind)));

	// A character scheme studies recognition and writing cards; every
	// other scheme is a word scheme (vocab only).
	const levelUnit = $derived<LevelUnit>(selectedScheme?.unit === 'character' ? 'character' : 'word');

	const levelCounts = $derived.by(() => {
		if (levelSelection === null || levelEntries.length === 0 || !levelUsable(levelUnit, levelKinds)) {
			return { due: 0, fresh: 0, items: 0, unitLabel: levelUnit === 'character' ? 'characters' : 'words' } as const;
		}
		return levelPlanCounts({
			entries: levelEntries,
			cards,
			reviews,
			now: new Date(),
			w: weights,
			unit: levelUnit,
			kinds: levelKinds,
			ctx,
			hasStrokes: hasStrokeData,
			// A word buried by a reverse or cloze answer today is left out, as in the session.
			excludeEntries: buriedLevelEntries(
				buriedNow({ cards, reviews, now: new Date(), studyDay: ctx.day }),
				cards
			),
			// Items this tab already found unsuitable are not counted.
			skip: activeWorkspaceId === null ? undefined : loadIneligible(activeWorkspaceId)
		});
	});

	// Selected types that have nothing to study: a warning, not a block,
	// as long as another selected type has cards.
	const typeWarnings = $derived.by((): string[] => {
		if (mode === 'levels') return levelTypeWarnings(levelUnit, levelKinds);
		if (selectedCards.length === 0) return [];
		return selectedKinds
			.filter((kind) => deckPlan.byKind[kind] === 0)
			.map(
				(kind) =>
					t('study.setup.nothingOfType', { type: CARD_TYPES.find((type) => type.id === kind)?.label ?? kind })
			);
	});

	const counts = $derived(mode === 'levels' ? levelCounts : deckCounts);
	const levelEntryTotal = $derived(levelEntryCount(levelEntries, levelUnit));
	const levelNoun = $derived(
		levelUnit === 'character'
			? t('study.setup.unit.characters', { count: levelEntryTotal })
			: t('study.setup.unit.words', { count: levelEntryTotal })
	);

	// True when no deck of the session has a daily limit (the note is dropped then).
	const noDailyLimit = $derived(
		mode === 'levels'
			? false
			: selectedDeckIds.length > 0 &&
					selectedDeckIds.every((id) => {
						const limit = limitsOf(ctx, id);
						return limit.new === null && limit.reviews === null;
					})
	);

	// "Vacation until 3 Jan": nothing is due and no new card is offered today.
	const vacationText = $derived(
		activeWorkspaceId === null || !ctx.vacationToday
			? null
			: vacationBanner(
					vacationStatus(vacations, activeWorkspaceId, ctx.day.today()),
					ctx.day.today()
				)
	);

	const guidance = $derived.by(() => {
		if (noWorkspace) return t('study.guide.noWorkspace');
		if (loading) return t('study.guide.loading');
		if (selectedKinds.length === 0) return t('study.config.selectType');

		if (mode === 'levels') {
			if (!schemesLoaded) return t('study.guide.loadingSchemes');
			if (schemeError) return schemeError;
			if (schemesForLanguage.length === 0) {
				return t('study.guide.noSchemes');
			}
			if (levelSelection === null) {
				return t('study.guide.chooseLevel');
			}
			if (levelEntriesError) return levelEntriesError;
			if (levelEntriesLoading) return t('study.guide.loadingLevel');
			if (levelEntries.length === 0) {
				return levelUnit === 'character' ? t('study.guide.levelNoCharacters') : t('study.guide.levelNoWords');
			}
			if (!levelUsable(levelUnit, levelKinds)) {
				return levelUnit === 'character'
					? t('study.guide.characterKinds')
					: t('study.guide.vocabOnly');
			}
			if (counts.due + counts.fresh === 0) {
				if (levelUnit === 'character' && !selectedKinds.includes('vocab')) {
					return t('study.guide.nothingToWrite');
				}
				return t('study.guide.levelDone');
			}
			return '';
		}

		if (selectedDeckIds.length === 0) return t('study.guide.selectDeck');
		if (selectedCards.length === 0) {
			return t('study.guide.noCards');
		}
		if (counts.due + counts.fresh === 0) {
			return t('study.guide.decksDone');
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
		if (isOptIn(id)) {
			const next = !extraKinds.includes(id as OptInKind);
			extraChoices = { ...extraChoices, [id]: next };
			if (activeWorkspaceId !== null) rememberExtraChoice(activeWorkspaceId, id as OptInKind, next);
			return;
		}
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
			deckError = message(err, t('study.decks.createFailed'));
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
			deckError = t('study.decks.nameEmpty');
			return;
		}

		deckError = '';
		try {
			const renamed = await renameDeck(id, name);
			decks = decks.map((deck) => (deck.id === id ? renamed : deck));
			cancelRename();
		} catch (err) {
			deckError = message(err, t('study.decks.renameFailed'));
		}
	}

	async function removeDeck(deck: Deck): Promise<void> {
		if (deletingId !== null) return;
		if (
			!confirm(t('study.decks.confirmDelete', { deck: deck.name }))
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
			deckError = message(err, t('study.decks.deleteFailed'));
		} finally {
			deletingId = null;
		}
	}

	const orderView = $derived(
		sessionOrderChoices({
			mode,
			language: workspaceLanguage ?? '',
			packs: frequencyPacks,
			schemes: schemesForLanguage,
			levelScheme: selectedScheme
		})
	);
	// A value the current mode does not offer (switched mode, pack removed) is the default.
	const orderValue = $derived(
		orderView.choices.some((choice) => choice.value === newOrderValue) ? newOrderValue : 'deck'
	);
	const ordersMixed = $derived(
		mode === 'decks' &&
			orderValue === 'deck' &&
			resolveSessionOrder('deck', deckOrdersOf(selectedDeckIds, decks, deckSettings)).mixed
	);

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
			// Existing kinds as set up (hidden ones stay), plus the checked opt-in kinds.
			cardTypes: [...cardTypes.filter((kind) => !isOptIn(kind)), ...extraKinds]
		};
		const order = decodeOrder(orderValue);
		if (order !== 'deck') config.newOrder = order;
		// Validate what the session will actually use: a type hidden in
		// this workspace does not count towards "at least one".
		errors = validateConfig({ ...config, cardTypes: [...selectedKinds] });
		// A saved scheme from another workspace language still has a
		// positive id and a level name, so validation alone cannot catch
		// it; the resolved selection can.
		if (errors.length === 0 && mode === 'levels' && levelSelection === null) {
			errors = [t('study.setup.levelGone')];
		}
		if (errors.length > 0) return;

		starting = true;
		saveConfig(config);
		if (activeWorkspaceId !== null) rememberCardTypes(activeWorkspaceId, config.cardTypes);
		void goto('/study/session');
	}
</script>

<svelte:head>
	<title>{pageTitle(t('study.setup.title'))}</title>
</svelte:head>

<main class="setup">
	<h1>{t('study.setup.title')}</h1>

	{#if vacationText !== null}
		<p class="vacation" role="status">{vacationText}. <a href="/settings?tab=study">{t('study.setup.change')}</a></p>
	{/if}
	<p class="hint">{t('study.setup.intro')}</p>
	{#if $workspaces.current && usesHan($workspaces.current.language)}
		<p class="hint"><a href="/stats/characters">{t('study.setup.masteryMap')}</a></p>
	{/if}

	{#if loadError}
		<p class="error" role="alert">{loadError}</p>
	{:else if noWorkspace}
		<p class="hint" role="status">{t('study.guide.noWorkspace')}</p>
	{:else if loading}
		<p class="hint" role="status">{t('study.guide.loading')}</p>
	{:else}
		<section aria-labelledby="mode-heading">
			<h2 id="mode-heading">{t('study.setup.source')}</h2>
			<div class="modes" role="radiogroup" aria-labelledby="mode-heading">
				<label class="inline">
					<input
						type="radio"
						name="session-mode"
						value="decks"
						checked={mode === 'decks'}
						onchange={() => selectMode('decks')}
					/>
					{t('study.setup.myDecks')}
				</label>
				<label class="inline">
					<input
						type="radio"
						name="session-mode"
						value="levels"
						checked={mode === 'levels'}
						onchange={() => selectMode('levels')}
					/>
					{t('study.setup.byLevel')}
				</label>
			</div>
		</section>

		{#if mode === 'decks'}
			<section aria-labelledby="decks-heading">
				<h2 id="decks-heading">{t('study.decks.title')}</h2>

				{#if decks.length === 0}
					<div class="empty">
						<h3>{t('study.decks.none')}</h3>
						<p>{t('study.decks.noneText')}</p>
					</div>
				{/if}

				<ul class="decks">
					{#each allDecks as deck (deck.id)}
						<li class="deck">
							{#if renamingId === deck.id}
								<form class="rename" onsubmit={(event) => submitRename(event, deck.id)}>
									<input
										bind:value={renameName}
										aria-label={t('study.decks.newName', { deck: deck.name })}
										maxlength="80"
										required
									/>
									<button type="submit">{t('common.action.save')}</button>
									<button type="button" class="secondary" onclick={cancelRename}>{t('common.action.cancel')}</button>
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
										<span class="tag">{t('study.decks.default')}</span>
									{/if}
								</label>

								{#if deck.id !== GENERAL_DECK_ID}
									<div class="deck-actions">
										<button type="button" class="secondary" onclick={() => beginRename(deck)}>
											{t('study.decks.rename')}
										</button>
										<button
											type="button"
											class="danger"
											disabled={deletingId === deck.id}
											onclick={() => removeDeck(deck)}
										>
											{deletingId === deck.id ? t('study.decks.deleting') : t('common.action.delete')}
										</button>
									</div>
								{/if}
								<div class="deck-types">
									<DeckCardTypes
										deckId={deck.id}
										deckName={deck.name}
										cardTypes={deckSettings[deck.id]?.cardTypes ?? []}
										onSaved={(saved) => (deckSettings = { ...deckSettings, [deck.id]: saved })}
									/>
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				<form class="create" onsubmit={addDeck}>
					<label>
						{t('study.decks.new')}
						<input
							bind:value={deckName}
							placeholder={t('study.decks.newPlaceholder')}
							maxlength="80"
							autocomplete="off"
							required
						/>
					</label>
					<button type="submit" disabled={creating}>
						{creating ? t('study.decks.creating') : t('study.decks.create')}
					</button>
				</form>

				{#if deckError}
					<p class="error" role="alert">{deckError}</p>
				{/if}
			</section>

			<CardManager {cards} decks={allDecks} onchanged={refreshData} />
		{:else}
			<section aria-labelledby="levels-heading">
				<h2 id="levels-heading">{t('study.level.title')}</h2>
				<p class="hint">{t('study.level.intro')}</p>

				{#if schemeError}
					<p class="error" role="alert">{schemeError}</p>
				{:else if !schemesLoaded}
					<p class="hint" role="status">{t('study.level.loadingSchemes')}</p>
				{:else if schemesForLanguage.length === 0}
					<p class="hint">{t('study.level.noSchemes')}</p>
				{:else}
					<div class="levels">
						<label>
							{t('study.level.scheme')}
							<select bind:value={schemeId}>
								{#each schemesForLanguage as scheme (scheme.id)}
									<option value={scheme.id}>{scheme.name}</option>
								{/each}
							</select>
						</label>
						<label>
							{t('study.level.level')}
							<select bind:value={levelName}>
								{#each schemeLevels as level (level.id)}
									<option value={level.name}>{levelOptionLabel(level.name)}</option>
								{/each}
							</select>
						</label>
					</div>

					{#if levelEntriesError}
						<p class="error" role="alert">{levelEntriesError}</p>
					{:else if levelEntriesLoading}
						<p class="hint" role="status">{t('study.guide.loadingLevel')}</p>
					{/if}
				{/if}
			</section>
		{/if}

		<section aria-labelledby="limits-heading">
			<h2 id="limits-heading">{t('study.limitsSection.title')}</h2>
			<p class="hint">{t('study.limitsSection.intro')}</p>

			<div class="limits">
				<label>
					{t('study.limitsSection.newCards')}
					<input type="number" min="1" max="999" step="1" bind:value={newLimit} />
				</label>
				<label>
					{t('study.limitsSection.reviews')}
					<input type="number" min="1" max="999" step="1" bind:value={reviewLimit} />
				</label>
			</div>
			<label class="order">
				{t('study.limitsSection.order')}
				<select
					value={orderValue}
					onchange={(event) => (newOrderValue = (event.currentTarget as HTMLSelectElement).value)}
				>
					{#each orderView.choices as choice (choice.value)}
						<option value={choice.value}>{choice.label}</option>
					{/each}
				</select>
			</label>
			{#if ordersMixed}
				<p class="hint" role="status">{mixedNote()}</p>
			{/if}
			{#if orderView.hint !== null}
				<p class="hint">{orderView.hint}</p>
			{/if}
			<p class="hint">
				<a href="/study/scheduling">{t('study.limitsSection.scheduling', { label: schedulingLabel })}</a>
			</p>
		</section>

		<section aria-labelledby="types-heading">
			<h2 id="types-heading">{t('study.types.title')}</h2>

			<p class="hint">{t('study.types.intro')}</p>
			<ul class="types">
				{#each visibleTypes as type (type.id)}
					<li>
						<label class="type-choice">
							<input
								type="checkbox"
								checked={isChecked(type.id)}
								aria-describedby={`type-${type.id}-info`}
								onchange={() => toggleCardType(type.id)}
							/>
							<span class="type-label">{type.label}</span>
							<span class="type-info" id={`type-${type.id}-info`}>{TYPE_INFO[type.id]}</span>
						</label>
					</li>
				{/each}
			</ul>
		</section>

		<section class="summary" aria-labelledby="summary-heading">
			<h2 id="summary-heading">{t('study.summary.title')}</h2>
			{#if vacationText === null}
				<p class="today">{startTodayText(counts.due, counts.fresh, noDailyLimit)}</p>
			{/if}
			{#if mode === 'levels'}
				<p class="stats">
					<strong>{levelEntryTotal}</strong>
					{t('study.summary.levelIn', { noun: levelNoun })}
					<strong>{selectedScheme?.name ?? t('study.summary.thisScheme')}</strong>
					{levelSelection?.levelName ?? ''} ·
					<strong>{counts.due}</strong>
					{t('study.summary.dueDot')}
					<strong>{counts.fresh}</strong>
					{t('study.summary.new')}
				</p>
			{:else}
				<p class="stats">
					<strong>{selectedCards.length}</strong>
					{t('study.summary.cardsIn', { count: selectedCards.length })}
					<strong>{selectedDeckIds.length}</strong>
					{t('study.summary.decksDot', { count: selectedDeckIds.length })}
					<strong>{counts.due}</strong>
					{t('study.summary.dueDot')}
					<strong>{counts.fresh}</strong>
					{t('study.summary.new')}
				</p>
				{#if plannedCompanions > 0}
					<p class="hint">
						{t('study.summary.companions', { count: plannedCompanions })}
					</p>
				{/if}
			{/if}

			{#if typeWarnings.length > 0}
				<ul class="warnings" aria-label={t('study.summary.warnings')}>
					{#each typeWarnings as warning (warning)}
						<li>{warning}</li>
					{/each}
				</ul>
			{/if}

			{#if errors.length > 0}
				<ul class="errors" role="alert">
					{#each errors as error (error)}
						<li>{error}</li>
					{/each}
				</ul>
			{/if}

			{#if vacationText === null}
				<button type="button" class="start" disabled={starting || guidance !== ''} onclick={start}>
					{starting ? t('study.summary.starting') : t('study.summary.start')}
				</button>
			{/if}

			{#if guidance && vacationText === null}
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

	.type-choice {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 0.55rem;
		row-gap: 0.1rem;
		align-items: center;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		padding: 0.55rem 0.75rem;
		cursor: pointer;
	}

	.type-choice:focus-within {
		border-color: #0b6bcb;
	}

	.type-label {
		font-weight: 600;
	}

	.type-info {
		grid-column: 2;
		font-size: 0.9rem;
		opacity: 0.8;
	}

	.warnings {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
		color: #8a5a00;
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

	.deck-types {
		flex-basis: 100%;
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
	.order,
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

	.order {
		margin-top: 0.75rem;
		max-width: 100%;
	}

	.order select {
		max-width: 100%;
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
	.order select,
	.rename input,
	.setup button {
		font: inherit;
	}

	.create input,
	.limits input,
	.levels select,
	.order select,
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
