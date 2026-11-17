<script lang="ts">
	import { studyLang } from '$lib/i18n/lang';
	import { t } from '$lib/i18n';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { record as recordEvent } from '$lib/events';
	import { readPayload } from '$lib/eventPayloads';
	import { setSettings, workspaces } from '$lib/workspaces';
	import { segmentWithReadings } from '$lib/api/segment';
	import { scheduleIndex } from '../flashcards/decks/deckStats';
	import { activeWeights, onStudyWrite } from '$lib/study/store';
	import { loadStudyHistory } from '$lib/study/history';
	import { contextForData } from '$lib/study/currentContext';
	import { createReadingTimer } from './readingTimer';
	import { workspaceForBook } from './readingWorkspace';
	import {
		addBookmark,
		addHighlight,
		deleteBookmark,
		deleteHighlight,
		getBook,
		getChapter,
		listBookmarks,
		listHighlights,
		renameBookmark,
		setPosition,
		updateHighlight,
		type NewHighlight
	} from '$lib/api/library';
	import type { Book, Chapter } from '$lib/api/types';
	import BookmarksPanel from './BookmarksPanel.svelte';
	import ChapterText from './ChapterText.svelte';
	import DisplayPanel from './DisplayPanel.svelte';
	import { createDisplayController, type DisplayController } from './displayController';
	import { DEFAULT_DISPLAY } from './displaySettings';
	import { ReadingsController } from './readings.svelte';
	import { createReveal, revealKey } from './reveal';
	import { EMPTY_KNOWN_INDEX, familiarity, knownIndex, type KnownIndex } from '$lib/study/known';
	import { loadEntryBases } from '$lib/api/entryBases';
	import { loadRawStudyData, pushStudy, setKnownMarks } from '$lib/study/store';
	import type { Deck } from '$lib/study/types';
	import WordsPanel from './WordsPanel.svelte';
	import { stateLineText, wordCountsSupported } from './wordsPanel';
	import { createLatestLoad, type LatestLoad } from './latestLoad';
	import { coverageOf, mergeTallies, tallyChapter, unknownList, type ChapterTally } from './coverage';
	import { createBookCounter, type BookCounter } from './bookCounter';
	import { addWords, markWords } from './wordActions';
	import HighlightEditor from './HighlightEditor.svelte';
	import HighlightsPanel from './HighlightsPanel.svelte';
	import { HighlightList } from './highlightList.svelte';
	import { visibleHighlights, type Highlight, type HighlightColor } from './highlights';
	import {
		clampNotice,
		elsewhereNotice,
		overlapNotice,
		addFailure,
		neighbourAfter,
		tooLongNotice,
		highlightKey,
		highlightKeyBusy,
		loadLastColor,
		planHighlight,
		saveLastColor,
		type HighlightActions,
		type ParagraphSpan
	} from './highlightUi';
	import PopupStackView from './PopupStackView.svelte';
	import ReaderRail from './ReaderRail.svelte';
	import {
		loadRailState,
		railMode,
		saveRailState,
		type RailTab
	} from './railState';
	import { topParagraph as firstInView } from './visibility';
	import { BookmarkList, bookmarkKey, inWidget, isTextEntry } from './bookmarkList.svelte';
	import { bookmarkedParagraphs, snippetAt, type Bookmark } from './bookmarks';
	import { paragraphElement } from './dom';
	import { apiErrorMessage } from './errors';
	import { displayRuns, paragraphString } from './paragraphText';
	import { inPopup } from './popupPointer.svelte';
	import { chapterTitle, formatPosition, type Position } from './position';
	import { jumpPlan, restoreDecision, restorePlan } from './restore';
	import { PositionSaver } from './positionSaver';
	import { browserStorage, loadPrefs, saveFurigana, saveVariant } from './prefs';
	import { LIBRARY_HREF, bookHref, safeHttpUrl } from './route';
	import { LookupController } from './useLookup.svelte';
	import { recordLookup } from '$lib/lookups/sink';
	import { lookupRecorder } from '$lib/lookups/store';
	import { prepareVariant, type Variant } from './variants';

	let { id, chapter }: { id: number; chapter: number } = $props();

	const SAVE_DELAY_MS = 1000;
	const ACTIVITY_THROTTLE_MS = 1000;
	const FLUSH_EVERY_MS = 5 * 60 * 1000;

	let book = $state<Book | null>(null);
	let bookError = $state('');
	let content = $state<{ n: number; data: Chapter } | null>(null);
	let chapterError = $state('');
	let container = $state<HTMLElement | null>(null);
	let prefs = $state(loadPrefs(browserStorage()));

	$effect(() => saveVariant(browserStorage(), prefs.variant));

	// The chosen script applies once its converter has loaded; until then
	// (or if loading fails) the text stays as it is.
	const wantedVariant = $derived<Variant>(book?.language === 'zh' ? prefs.variant : 'original');
	let variant = $state<Variant>('original');
	let variantError = $state('');
	$effect(() => {
		const wanted = wantedVariant;
		variantError = '';
		prepareVariant(wanted).then(
			() => {
				if (wanted === wantedVariant) variant = wanted;
			},
			() => {
				if (wanted === wantedVariant) variantError = t('reader.book.converterFailed');
			}
		);
	});
	const paragraphs = $derived(content ? content.data.paragraphs.map((p) => displayRuns(p, variant)) : []);
	const hasRuby = $derived(content?.data.paragraphs.some((p) => p.some((run) => run.ruby)) ?? false);
	// zh-Hans/zh-Hant pick the right glyph forms in fonts covering both.
	const textLang = $derived(studyLang(book?.language, { variant }) ?? '');
	const chapterCount = $derived(book?.chapterCount ?? 0);
	const sourceUrl = $derived(safeHttpUrl(book?.sourceUrl ?? ''));
	// Words looked up in the book are added to study in the book's workspace.
	const studyWorkspaceId = $derived(
		book ? workspaceForBook(book, $workspaces.list, $workspaces.current) : null
	);

	// --- side rail ---

	// Wide screens: a column beside the text (expanded or collapsed to its
	// tab strip, remembered). Narrow ones: a drawer that always starts
	// closed. Either way the rail is sticky or fixed, so using it never
	// scrolls the text (which a toolbar button at the top of the page did).
	let railState = $state(loadRailState(browserStorage()));
	$effect(() => saveRailState(browserStorage(), { open: railState.open, tab: railState.tab }));
	let viewportWidth = $state(typeof window === 'undefined' ? 0 : window.innerWidth);
	$effect(() => {
		const onResize = (): void => void (viewportWidth = window.innerWidth);
		window.addEventListener('resize', onResize, { passive: true });
		return () => window.removeEventListener('resize', onResize);
	});
	const mode = $derived(railMode(viewportWidth));
	let drawerOpen = $state(false);
	// Back to a wide window: the drawer is gone; coming back starts closed.
	$effect(() => {
		if (mode === 'column') drawerOpen = false;
	});
	const railOpen = $derived(mode === 'column' ? railState.open : drawerOpen);
	// The Words tab is shown: it needs the matches and the known index.
	const wordsPanelOpen = $derived(railOpen && railState.tab === 'words');

	// --- display settings and generated readings (per workspace) ---

	let display = $state(DEFAULT_DISPLAY);
	let displayNotice = $state('');
	let displayController: DisplayController | null = null;
	const settingsOf = (wsId: number) => $workspaces.list.find((w) => w.id === wsId)?.settings ?? null;

	$effect(() => {
		const wsId = studyWorkspaceId;
		untrack(() => {
			void displayController?.flush();
			displayController?.destroy();
			displayController = null;
			if (wsId === null) {
				display = { ...DEFAULT_DISPLAY, bookRuby: prefs.furigana };
				return;
			}
			displayController = createDisplayController({
				settings: () => settingsOf(wsId),
				localFurigana: () => prefs.furigana,
				save: (patch) => setSettings(wsId, patch),
				onError: (err) => (displayNotice = apiErrorMessage(err, 'display')),
				onChange: (next) => (display = next)
			});
			display = displayController.display;
		});
	});
	// Settings changed elsewhere (another tab, the server's copy of our own save).
	$effect(() => {
		void $workspaces;
		untrack(() => displayController?.adopt());
	});
	onDestroy(() => {
		void displayController?.flush();
		displayController?.destroy();
	});

	function changeDisplay(change: Partial<typeof display>): void {
		displayNotice = '';
		displayController?.change(change);
		if (!displayController) {
			// No workspace to hold the setting: remember book ruby in this browser.
			display = { ...display, ...change };
			if (change.bookRuby !== undefined) {
				prefs.furigana = change.bookRuby;
				saveFurigana(browserStorage(), change.bookRuby);
			}
		}
	}

	let showAll = $state(false);
	const reveal = createReveal({ onAll: (v) => (showAll = v) });

	// The known index (study/known.ts: cards, scores and manual marks) is only
	// needed to hide readings (smart): one replay of the workspace's review
	// log per open, again after study writes.
	let index = $state.raw<KnownIndex>(EMPTY_KNOWN_INDEX);
	// Smart readings, word states and the Words panel need it (zh and ja only).
	const wantsIndex = $derived(
		wordCountsSupported(book?.language ?? '') && (display.readings === 'smart' || display.highlightWords || wordsPanelOpen)
	);
	let studyDecks = $state.raw<Deck[]>([]);
	// Whose index `index` is, and whether it is loaded: the Words panel waits for it.
	let indexWs: number | null = null;
	let indexState = $state<'loading' | 'ready' | 'error'>('loading');
	let indexLoad: LatestLoad | null = null;
	$effect(() => {
		const wsId = studyWorkspaceId;
		if (!wantsIndex || wsId === null) return;
		untrack(() => {
			if (indexWs !== wsId) {
				// Another workspace: nothing of the previous one's cards may count here.
				indexWs = wsId;
				index = EMPTY_KNOWN_INDEX;
				studyDecks = [];
				indexState = 'loading';
			}
		});
		const loader = createLatestLoad(
			async () => {
				const data = await loadStudyHistory(wsId);
				const schedules = scheduleIndex(data.cards, data.reviews, activeWeights(data), contextForData(data, wsId).clock);
				return { index: knownIndex(data.cards, (cardId) => schedules.get(cardId) ?? null, data.known), decks: data.decks };
			},
			(v) => {
				index = v.index;
				studyDecks = v.decks;
				indexState = 'ready';
			},
			() => {
				// Without the index nothing counts as known: every reading stays shown,
				// and the Words panel says it could not load the cards.
				if (indexState !== 'ready') indexState = 'error';
			}
		);
		indexLoad = loader;
		void loader.reload();
		const off = onStudyWrite((changed) => {
			if (changed === wsId) void loader.reload();
		});
		return () => {
			loader.dispose();
			if (indexLoad === loader) indexLoad = null;
			off();
		};
	});
	function retryIndex(): void {
		indexState = 'loading';
		void indexLoad?.reload();
	}
	// A bulk write notifies once per pushed chunk: reload the index once, after it.
	function batched<R>(run: () => Promise<R>): Promise<R> {
		return indexLoad ? indexLoad.batch(run) : run();
	}

	const readings = new ReadingsController((text, signal) => segmentWithReadings(book?.language ?? '', text, signal));
	// One match source for readings, word states and coverage.
	// Primitives, so a display change that keeps both does not restart a load.
	const wantReadings = $derived(display.readings !== 'never');
	const wantWords = $derived(display.highlightWords || wordsPanelOpen);
	const wantsMatches = $derived(wantReadings || wantWords);
	const wantOf = (): { readings: boolean; words: boolean } => ({ readings: wantReadings, words: wantWords });
	$effect(() => {
		if (!wantsMatches || !book || !content || content.n !== chapter) {
			untrack(() => readings.stop());
			return;
		}
		const runs = paragraphs;
		const key = `${id}:${content.n}:${variant}`;
		untrack(() =>
			void readings.run({ key, lang: book!.language, runs, start: topParagraph ?? 0, display, index, want: wantOf() })
		);
	});
	$effect(() => {
		const next = display;
		const idx = index;
		const w = wantOf();
		untrack(() => readings.update(next, idx, w));
	});
	onDestroy(() => readings.stop());

	// `R` shows or hides every concealed reading (smart mode, outside fields).
	$effect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (display.readings !== 'smart') return;
			const target = e.target instanceof HTMLElement ? e.target : null;
			const busy = highlightKeyBusy(target, document, inPopup(e.target));
			if (!revealKey(e, { busy })) return;
			e.preventDefault();
			reveal.toggleAll();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	const lookup = new LookupController({
		container: () => container,
		lang: () => book?.language ?? '',
		textLang: () => textLang,
		runsOf: (p) => paragraphs[p],
		// The lookup history (#72), in the book's workspace like "+".
		onLookup: (entryId) => recordLookup(studyWorkspaceId, { entryId, source: 'reader', bookId: book?.id })
	});
	$effect(() => lookup.attach());
	// One read of the history for the popup's "looked up N times" hint.
	$effect(() => {
		const ws = studyWorkspaceId;
		if (ws !== null) void lookupRecorder().load(ws).catch(() => undefined);
	});
	// The text under a popup is re-rendered (chapter, script or furigana
	// change): drop the popup rather than leave it pointing at nothing.
	$effect(() => {
		void paragraphs;
		void display.bookRuby;
		lookup.close();
	});

	// --- loading ---

	let bookSeq = 0;
	let chapterSeq = 0;

	async function loadBook(bookId: number): Promise<void> {
		const seq = ++bookSeq;
		saver.flush();
		tracking = false;
		book = null;
		bookError = '';
		try {
			const loaded = await getBook(bookId);
			if (seq !== bookSeq) return;
			book = loaded;
			planRestore(loaded);
		} catch (err) {
			if (seq === bookSeq) bookError = apiErrorMessage(err, 'book');
		}
	}

	async function loadChapter(bookId: number, n: number): Promise<void> {
		const seq = ++chapterSeq;
		content = null;
		chapterError = '';
		try {
			const data = await getChapter(bookId, n);
			if (seq === chapterSeq) content = { n, data };
		} catch (err) {
			if (seq === chapterSeq) chapterError = apiErrorMessage(err, 'chapter');
		}
	}

	// The props are getters on the page's parsed route, a new object on
	// every navigation: read through a derived number, the book (and its
	// bookmarks) reload only when the book changes, not on every chapter
	// change (which also left position tracking off after the first one).
	const openBookId = $derived(id);
	$effect(() => void loadBook(openBookId));
	$effect(() => void loadChapter(id, chapter));

	// --- reading position ---

	// The restore rule lives in restore.ts. It is applied once per opened
	// book; chapter navigation inside the book never restores again, and a
	// restore that cannot happen (the reader went elsewhere, the chapter
	// failed, the jump failed) is dropped rather than blocking reading.
	let restoredBook = 0;
	let restoreTo = $state<Position | null>(null);
	// Set with restoreTo by a bookmark jump (not by the automatic restore).
	let focusAfterRestore = false;
	// A highlight jump: the highlight to focus once there.
	let focusMark: number | null = null;

	// Focus an element that is not a tab stop (a paragraph, a highlight):
	// focusable only until focus leaves it again.
	function focusQuietly(el: HTMLElement): void {
		if (!el.hasAttribute('tabindex')) {
			el.tabIndex = -1;
			el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
		}
		el.focus({ preventScroll: true });
	}
	// Positions are saved only once the restore settled, so opening a book
	// never overwrites the saved place with the top of chapter 0.
	let tracking = $state(false);
	const saver = new PositionSaver(setPosition, SAVE_DELAY_MS);

	function planRestore(loaded: Book): void {
		if (restoredBook === loaded.id) return;
		restoredBook = loaded.id;
		saver.reset(loaded.position);
		const plan = restorePlan(loaded.position, loaded.chapterCount, chapter);
		if (plan.kind === 'none') {
			tracking = true;
		} else if (plan.kind === 'scroll') {
			restoreTo = plan.target;
		} else {
			// Arm the restore only once the jump has landed; the decision
			// below drops it if the reader has meanwhile gone elsewhere.
			goto(bookHref(loaded.id, plan.target.chapter), { replaceState: true, noScroll: true })
				.then(tick)
				.then(
					() => (restoreTo = plan.target),
					() => (tracking = true)
				);
		}
	}

	$effect(() => {
		const target = restoreTo;
		if (!target) return;
		const decision = restoreDecision({
			target,
			urlChapter: chapter,
			loadedChapter: content?.n ?? null,
			loadFailed: chapterError !== ''
		});
		if (decision === 'wait') return;
		restoreTo = null;
		const focus = focusAfterRestore;
		const mark = focusMark;
		focusAfterRestore = false;
		focusMark = null;
		if (decision === 'skip') {
			tracking = true;
			return;
		}
		void tick().then(() => {
			const el = container && paragraphElement(container, target.paragraph);
			el?.scrollIntoView({ block: 'start' });
			// A bookmark jump moves keyboard focus to the paragraph, so the
			// next Tab continues from the text rather than the panel above.
			// A highlight jump focuses the highlight itself (Enter edits it).
			const markEl = mark !== null && el ? el.querySelector<HTMLElement>(`mark[data-h="${mark}"]`) : null;
			if (el && focus) focusQuietly(markEl ?? el);
			tracking = true;
		});
	});

	// Leaving the reading view saves a still-pending position at once, and
	// invalidates a book load still in flight so its restore jump (goto)
	// cannot pull the reader back into the book.
	onMount(() => () => {
		bookSeq++;
		saver.flush();
	});

	// The first paragraph in view is the position. The <p> elements are
	// keyed by index, so script and furigana toggles keep them observed.
	$effect(() => {
		const el = container;
		const n = content?.n;
		const bookId = book?.id;
		if (!tracking || !el || n === undefined || bookId === undefined) return;
		const visible = new Set<number>();
		const observer = new IntersectionObserver((records) => {
			const top = firstInView(visible, records);
			if (top !== null) saver.schedule(bookId, formatPosition(n, top));
		});
		for (const p of el.querySelectorAll('[data-p]')) observer.observe(p);
		return () => observer.disconnect();
	});

	// --- bookmarks ---

	const bookmarks = new BookmarkList({
		list: listBookmarks,
		add: addBookmark,
		rename: renameBookmark,
		remove: deleteBookmark
	});
	$effect(() => {
		const current = openBookId;
		untrack(() => void bookmarks.load(current));
	});

	// Chapter titles seen in this visit, for the panel (the book itself
	// only knows how many chapters it has).
	let chapterTitles = $state<Record<number, string>>({});
	$effect(() => {
		void openBookId;
		chapterTitles = {};
	});
	$effect(() => {
		const loaded = content;
		if (loaded) untrack(() => (chapterTitles = { ...chapterTitles, [loaded.n]: loaded.data.title }));
	});

	// The bookmark spot is the reading position: the first paragraph in
	// view. Watched on its own (also before the restore settled) so the
	// position saving above stays exactly as it was.
	let topParagraph = $state<number | null>(null);
	$effect(() => {
		const el = container;
		const n = content?.n;
		topParagraph = null;
		if (!el || n === undefined) return;
		const visible = new Set<number>();
		const observer = new IntersectionObserver((records) => {
			const top = firstInView(visible, records);
			if (top !== null) topParagraph = top;
		});
		for (const p of el.querySelectorAll('[data-p]')) observer.observe(p);
		return () => observer.disconnect();
	});

	const here = $derived(
		content && content.n === chapter && topParagraph !== null && topParagraph < paragraphs.length
			? { chapter: content.n, paragraph: topParagraph }
			: null
	);
	const herePosition = $derived(here ? formatPosition(here.chapter, here.paragraph) : null);
	const hereBookmark = $derived(herePosition ? bookmarks.at(herePosition) : null);
	const canToggle = $derived(herePosition !== null && bookmarks.ready && !bookmarks.saving);
	// A failed load leaves the button live: pressing it (or `b`) retries.
	const bookmarksFailed = $derived(bookmarks.loadError !== '' && !bookmarks.loading);
	const marked = $derived(content ? bookmarkedParagraphs(bookmarks.items, content.n) : new Set<number>());

	function toggleBookmark(): void {
		if (bookmarksFailed) {
			void bookmarks.toggle('', '');
			return;
		}
		if (!canToggle || !here || !herePosition || !content) return;
		const label =
			snippetAt(paragraphString(paragraphs[here.paragraph] ?? [])) ||
			snippetAt(chapterTitle(content.data.title, content.n));
		void bookmarks.toggle(herePosition, label);
	}

	$effect(() => {
		const onKey = (e: KeyboardEvent): void => {
			const popupOpen = lookup.info !== null || inPopup(e.target);
			const target = e.target instanceof HTMLElement ? e.target : null;
			// A focused or open listbox, menu or dialog owns the keys too.
			const busy = isTextEntry(target) || inWidget(target, document);
			if (!bookmarkKey(e, { typing: busy, popupOpen })) return;
			e.preventDefault();
			toggleBookmark();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function jumpToBookmark(b: Bookmark): void {
		if (!jumpTo(b.position)) bookmarks.error = t('reader.book.bookmarkMissing');
	}

	// An explicit jump (bookmark or highlight): scroll there, through the
	// other chapter when needed, and move focus there. False when the book
	// has no such place.
	function jumpTo(position: string): boolean {
		const plan = jumpPlan(position, chapterCount, chapter);
		if (plan.kind === 'none') return false;
		focusAfterRestore = true;
		if (plan.kind === 'scroll') {
			restoreTo = plan.target;
			return true;
		}
		// Like the restore on opening: stop saving positions while the other
		// chapter loads, so its top is not saved on the way to the bookmark.
		tracking = false;
		goto(bookHref(id, plan.target.chapter), { noScroll: true })
			.then(tick)
			.then(
				() => (restoreTo = plan.target),
				() => {
					focusAfterRestore = false;
					focusMark = null;
					tracking = true;
				}
			);
		return true;
	}

	// --- highlights ---

	const highlights = new HighlightList({
		list: listHighlights,
		add: addHighlight,
		update: updateHighlight,
		remove: deleteHighlight
	});
	$effect(() => {
		const current = openBookId;
		untrack(() => void highlights.load(current));
	});
	const highlightsFailed = $derived(highlights.loadError !== '' && !highlights.loading);

	// Drawn on the open chapter when their snapshot still matches its
	// displayed text; the others are listed as "text changed".
	const visible = $derived(
		content
			? visibleHighlights(highlights.items, content.n, (p) =>
					paragraphs[p] ? paragraphString(paragraphs[p]) : null
				)
			: { drawn: new Map<number, Highlight[]>(), changed: [] as Highlight[] }
	);
	const changedIds = $derived(new Set(visible.changed.map((h) => h.id)));

	let lastColor = $state<HighlightColor>(loadLastColor(browserStorage()));
	function rememberColor(color: HighlightColor): void {
		lastColor = color;
		saveLastColor(browserStorage(), color);
	}

	// A short message about the last highlight attempt (shown in the
	// popup's bar) and what the polite live region says.
	let highlightNotice = $state('');
	let highlightLive = $state('');
	function tell(message: string): void {
		highlightNotice = message;
		if (message) highlightLive = message;
	}
	$effect(() => {
		const said = highlights.announcement;
		if (said) highlightLive = said;
	});
	// A new selection popup starts without the last one's notice.
	$effect(() => {
		void lookup.stack.frames[0]?.id;
		untrack(() => (highlightNotice = ''));
	});

	interface EditorState {
		key: number;
		id: number;
		anchor: HTMLElement;
		/** Where focus goes back to, if it is still there. */
		returnTo: HTMLElement | null;
		/** Opened from the text or from the panel: decides where focus goes after a delete. */
		from: 'text' | 'panel';
		/** Where the highlight is (reading order), for focus after it is gone. */
		place: { chapter: number; paragraph: number; start: number };
		focusNote: boolean;
		notice: string;
		/** A note to start from (carried over from a failed add). */
		initialNote?: string;
		/** The add of a "Note" highlight, while it may still fail (then retried with the note). */
		body?: NewHighlight;
		failure: string;
	}
	// Raw: replaced as a whole, never mutated (and `body` keeps its identity).
	let editor = $state.raw<EditorState | null>(null);
	let editorKey = 0;
	// The open editor's note as typed (kept when its add fails).
	let editorDraft = '';

	function markOf(hid: number): HTMLElement | null {
		return container?.querySelector<HTMLElement>(`mark[data-h="${hid}"]`) ?? null;
	}

	async function openEditor(
		hid: number,
		opts: {
			anchor?: HTMLElement | null;
			returnTo?: HTMLElement | null;
			from?: 'text' | 'panel';
			focusNote?: boolean;
			notice?: string;
			initialNote?: string;
			body?: NewHighlight;
		} = {}
	): Promise<void> {
		await tick();
		const h = highlights.get(hid);
		if (!h) return;
		const mark = markOf(h.id) ?? markOf(hid);
		const anchor = opts.anchor ?? mark ?? (container && paragraphElement(container, h.paragraph));
		if (!anchor) return;
		editorDraft = '';
		editor = {
			key: ++editorKey,
			id: hid,
			anchor,
			returnTo: opts.returnTo === undefined ? mark : opts.returnTo,
			from: opts.from ?? 'text',
			place: { chapter: h.chapter, paragraph: h.paragraph, start: h.start },
			focusNote: opts.focusNote ?? false,
			notice: opts.notice ?? '',
			initialNote: opts.initialNote,
			body: opts.body,
			failure: ''
		};
	}

	async function closeEditor(how: { deleted: boolean; refocus: boolean }): Promise<void> {
		const closing = editor;
		editor = null;
		if (!closing || !how.refocus) return;
		// Let a delete reach the DOM first: the mark or the panel row that
		// opened the editor may be on its way out.
		await tick();
		if (!how.deleted && closing.returnTo?.isConnected) {
			focusQuietly(closing.returnTo);
			return;
		}
		if (closing.from === 'panel') {
			// The next highlight in the panel, else the previous, else the tab.
			const next = how.deleted ? neighbourAfter(highlights.items, closing.place) : highlights.get(closing.id);
			const row = next && document.getElementById(`hl-jump-${next.id}`);
			const target = row ?? document.getElementById('rail-tab-highlights');
			if (target && target.getClientRects().length > 0) {
				target.focus({ preventScroll: true });
				return;
			}
		}
		const paragraph =
			container && content?.n === closing.place.chapter ? paragraphElement(container, closing.place.paragraph) : null;
		if (paragraph) focusQuietly(paragraph);
	}

	// Another chapter or book: the editor's highlight is not on screen.
	$effect(() => {
		void content?.n;
		void openBookId;
		untrack(() => (editor = null));
	});

	// An add was refused. Overlapping a highlight known here: open it (the
	// note typed for the failed one comes along, not yet saved). Otherwise
	// say why; an editor waiting on this add keeps the note and can retry.
	async function addRefused(
		result: { ok: false; existingId?: number; available?: boolean },
		waitingKey: number | null,
		withNote: boolean
	): Promise<void> {
		const failure = addFailure(result, highlights.error);
		const waiting = editor && waitingKey !== null && editor.key === waitingKey ? editor : null;
		const draft = waiting ? editorDraft : '';
		if (failure.kind === 'existing') {
			tell(overlapNotice());
			lookup.close();
			const existing = highlights.get(failure.id);
			const carried = draft.trim() && existing ? (existing.note ? `${existing.note}\n${draft}` : draft) : undefined;
			await openEditor(failure.id, { focusNote: withNote, notice: overlapNotice(), initialNote: carried });
			return;
		}
		// The store announces its own errors; this one it does not.
		if (failure.text === elsewhereNotice()) tell(failure.text);
		if (waiting) editor = { ...waiting, failure: failure.text };
	}

	async function retryAdd(draft: string): Promise<void> {
		const open = editor;
		if (!open?.body) return;
		const body: NewHighlight = { ...open.body, note: draft.trim() ? draft : undefined };
		editor = { ...open, body, failure: t('reader.book.tryingAgain') };
		const result = await highlights.add(body);
		if (editor?.key !== open.key) return;
		if (result.ok) {
			editor = null;
			await openEditor(result.highlight.id, { from: 'text' });
			return;
		}
		await addRefused(result, open.key, true);
	}

	/**
	 * highlightSelection highlights a selection in `color`; with `withNote`
	 * it also opens the editor on the note. A selection over an existing
	 * highlight recolours it when it is the same span, otherwise opens it.
	 */
	async function highlightSelection(
		span: ParagraphSpan | null,
		color: HighlightColor,
		withNote: boolean
	): Promise<void> {
		if (!content) return;
		if (!highlights.ready) {
			tell(highlightsFailed ? highlights.loadError : t('reader.book.highlightsLoading'));
			return;
		}
		const runs = span ? paragraphs[span.p] : undefined;
		const plan = planHighlight(span, runs ? paragraphString(runs) : null, content.n, color, highlights.items);
		if (plan.kind === 'none') {
			tell(t('reader.book.selectFirst'));
			return;
		}
		if (plan.kind === 'tooLong') {
			tell(tooLongNotice());
			return;
		}
		// The new colour shows on the text, not under the selection.
		window.getSelection()?.removeAllRanges();
		if (plan.kind === 'existing') {
			if (plan.exact && !withNote) {
				rememberColor(color);
				tell(plan.clamped ? clampNotice() : '');
				void highlights.update(plan.highlight.id, { color });
				return;
			}
			tell(plan.exact ? '' : overlapNotice());
			lookup.close();
			await openEditor(plan.highlight.id, { focusNote: withNote, notice: plan.exact ? '' : overlapNotice() });
			return;
		}
		rememberColor(color);
		tell(plan.clamped ? clampNotice() : '');
		const body = plan.body;
		const adding = highlights.add(body);
		let waitingKey: number | null = null;
		if (withNote) {
			// The editor replaces the popup. The new highlight shows at once
			// (a temporary id until it is saved; the editor follows it).
			lookup.close();
			const temp = highlights.items.find(
				(h) => h.id < 0 && h.chapter === body.chapter && h.paragraph === body.paragraph && h.start === body.start
			);
			if (temp) await openEditor(temp.id, { focusNote: true, notice: plan.clamped ? clampNotice() : '', body });
			waitingKey = editor?.body === body ? editor.key : null;
		}
		const result = await adding;
		if (!result.ok) await addRefused(result, waitingKey, withNote);
	}

	// The popup's action bar acts on the selection the popup was opened for.
	const highlighter: HighlightActions = {
		get color() {
			return lastColor;
		},
		get ready() {
			return highlights.ready;
		},
		get notice() {
			return highlightNotice;
		},
		pick: (color) => void highlightSelection(lookup.selectedSpan, color, false),
		note: () => void highlightSelection(lookup.selectedSpan, lastColor, true)
	};

	// `h` highlights the current selection in the last colour.
	$effect(() => {
		const onKey = (e: KeyboardEvent): void => {
			const target = e.target instanceof HTMLElement ? e.target : null;
			const busy = highlightKeyBusy(target, document, inPopup(e.target));
			if (!highlightKey(e, { busy })) return;
			const span =
				lookup.currentSelection() ?? (lookup.info?.mode === 'selection' ? lookup.selectedSpan : null);
			if (!span) return;
			e.preventDefault();
			void highlightSelection(span, lastColor, false);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function editFromText(hid: number, mark: HTMLElement): void {
		void openEditor(hid, { anchor: mark, returnTo: mark, from: 'text' });
	}

	function editFromPanel(h: Highlight, opener: HTMLElement): void {
		void openEditor(h.id, { anchor: opener, returnTo: opener, from: 'panel' });
	}

	function jumpToHighlight(h: Highlight): void {
		if (mode === 'drawer') drawerOpen = false;
		focusMark = h.id;
		if (!jumpTo(formatPosition(h.chapter, h.paragraph))) {
			focusMark = null;
			highlights.error = t('reader.book.highlightMissing');
		}
	}


	function toggleRail(open: boolean): void {
		if (mode === 'column') railState.open = open;
		else drawerOpen = open;
	}

	function selectTab(tab: RailTab): void {
		railState.tab = tab;
	}

	// The drawer covers the text: a jump closes it so the bookmark shows
	// (focus goes to the paragraph, as with every jump).
	function jumpFromRail(b: Bookmark): void {
		if (mode === 'drawer') drawerOpen = false;
		jumpToBookmark(b);
	}

	const railTabs = $derived([
		{ id: 'bookmarks' as const, label: t('reader.bookmarks.title'), alert: bookmarksFailed || bookmarks.error !== '' },
		{ id: 'highlights' as const, label: t('reader.highlights.title'), alert: highlightsFailed || highlights.error !== '' },
		{ id: 'words' as const, label: t('reader.words.title') }
	]);

	// --- words panel: coverage and unknown words (#68) ---

	const stateOf = (entryId: number) => familiarity(entryId, index, display.smartThreshold);
	// The popup's state line, only while words are highlighted.
	const wordStateLine = $derived.by(() => {
		if (!display.highlightWords) return null;
		const idx = index;
		const threshold = display.smartThreshold;
		return (entryId: number) => stateLineText(entryId, idx, threshold);
	});
	const chapterKey = $derived(content ? `${id}:${content.n}:${variant}` : '');
	// The open chapter's tally, once every paragraph of it has its matches.
	const chapterTally = $derived.by<ChapterTally | null>(() => {
		if (!wordsPanelOpen || !book || !content || readings.key !== chapterKey) return null;
		if (readings.progress.done < readings.progress.total) return null;
		return tallyChapter(content.n, book.language, paragraphs.map((p) => paragraphString(p)), readings.matches);
	});
	const chapterCounted = $derived(
		chapterTally === null ? null : { coverage: coverageOf(chapterTally, stateOf), list: unknownList(chapterTally, stateOf) }
	);

	// The whole-book count: on demand, per book and variant, memory only.
	let counter: BookCounter | null = null;
	let bookVersion = $state(0);
	let bookProgress = $state.raw<{ done: number; total: number } | null>(null);
	let bookFailed = $state(0);
	$effect(() => {
		void id;
		void variant;
		untrack(() => {
			counter?.abort();
			counter = null;
			bookProgress = null;
			bookFailed = 0;
			bookVersion++;
		});
	});
	function bookCounter(): BookCounter | null {
		const b = book;
		if (!b) return null;
		const v = variant;
		counter ??= createBookCounter({
			getChapter: (n) => getChapter(id, n),
			segment: (text, signal) => segmentWithReadings(b.language, text, signal),
			displayRuns: (p) => displayRuns(p, v),
			lang: b.language
		});
		return counter;
	}
	$effect(() => {
		const t = chapterTally;
		const n = content?.n;
		if (t === null || n === undefined) return;
		untrack(() => {
			bookCounter()?.put(n, t);
			bookVersion++;
		});
	});
	const bookCounted = $derived.by(() => {
		void bookVersion;
		if (counter === null || chapterCount === 0 || counter.tallies.size < chapterCount) return null;
		const t = mergeTallies(counter.tallies.values());
		return { coverage: coverageOf(t, stateOf), list: unknownList(t, stateOf) };
	});
	async function countBook(): Promise<void> {
		const c = bookCounter();
		if (!c) return;
		bookProgress = { done: 0, total: chapterCount };
		const { failed } = await c.count(chapterCount, (done, total) => (bookProgress = { done, total }));
		if (counter !== c) return;
		bookFailed = failed.length;
		bookProgress = null;
		bookVersion++;
	}
	function cancelBook(): void {
		counter?.abort();
		bookProgress = null;
	}
	function bookWorkspace(): number {
		const wsId = studyWorkspaceId;
		if (wsId === null) throw new Error('This book has no workspace to study in.');
		return wsId;
	}
	function addFromPanel(ids: number[], target: { id: string; name: string }) {
		const wsId = bookWorkspace();
		return batched(() => addWords({
			workspaceId: wsId,
			entryIds: ids,
			target,
			now: new Date(),
			bases: (x) => loadEntryBases(x),
			raw: () => loadRawStudyData(wsId),
			push: pushStudy
		}));
	}
	function markFromPanel(ids: number[]) {
		const wsId = bookWorkspace();
		return batched(async () => {
			const res = await markWords({ workspaceId: wsId, entryIds: ids, marked: index.marks, on: true, set: setKnownMarks });
			return { written: res.written, undo: () => batched(res.undo) };
		});
	}
	// Heard even while the rail is collapsed or the drawer closed (a `b`
	// press that failed, a list that could not load).
	const bookmarkAlert = $derived(bookmarks.error || (bookmarksFailed ? bookmarks.loadError : ''));
	const highlightAlert = $derived(highlights.error || (highlightsFailed ? highlights.loadError : ''));

	// --- reading time ---

	// One timer per opened book. The effect re-runs (cleanup first) when
	// the book changes or unmounts, so the flush there always carries the
	// id of the book that was actually read. flush() mutates synchronously,
	// so two quick flushes cannot report the same seconds twice.
	//
	// Reading is credited to the book's workspace (workspaceForBook; an
	// older server's book without one falls back to its language's). The
	// timer only ever holds time for one workspace: when that choice
	// changes (only possible on that fallback), the running burst is
	// flushed to the workspace it was read for and a fresh timer starts
	// (a carry under 30 s is dropped, as on a book switch). Without a
	// workspace nothing accrues and nothing is posted.
	$effect(() => {
		const bookId = book?.id;
		if (bookId === undefined) return;
		const ref = { workspaceId: book?.workspaceId, language: book?.language };

		let workspaceId: number | null = null;
		let timer = createReadingTimer();
		let lastFeed = -Infinity;

		const send = (): void => {
			const seconds = timer.flush(Date.now());
			if (seconds > 0 && workspaceId !== null) {
				void recordEvent('read', workspaceId, readPayload(bookId, seconds));
			}
		};
		// subscribe() calls back at once with the current selection.
		const unsubscribe = workspaces.subscribe((state) => {
			const next = workspaceForBook(ref, state.list, state.current);
			if (next === workspaceId) return;
			send();
			workspaceId = next;
			timer = createReadingTimer();
			if (document.visibilityState === 'hidden') timer.hidden(Date.now());
		});
		const feed = (): void => {
			if (workspaceId === null) return;
			const now = Date.now();
			if (now - lastFeed < ACTIVITY_THROTTLE_MS) return;
			lastFeed = now;
			timer.activity(now);
			if (timer.accrued() >= FLUSH_EVERY_MS) send();
		};
		const onVisibility = (): void => {
			if (document.visibilityState === 'hidden') {
				timer.hidden(Date.now());
				send();
			} else {
				timer.visible(Date.now());
			}
		};

		if (document.visibilityState === 'hidden') timer.hidden(Date.now());
		const passive = { passive: true, capture: true } as const;
		const events = ['scroll', 'pointermove', 'keydown', 'touchstart'] as const;
		for (const name of events) window.addEventListener(name, feed, passive);
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pagehide', send);

		return () => {
			unsubscribe();
			for (const name of events) window.removeEventListener(name, feed, passive);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', send);
			send();
		};
	});

	function jump(event: Event & { currentTarget: HTMLSelectElement }): void {
		void goto(bookHref(id, Number(event.currentTarget.value)));
	}
</script>

{#snippet chapterNav(label: string)}
	<nav class="chapters" aria-label={label}>
		{#if chapter > 0}
			<a href={bookHref(id, chapter - 1)} rel="prev">{t('reader.book.previous')}</a>
		{/if}
		{#if chapterCount > 1}
			<label>
				{t('reader.book.chapter')}
				<select value={chapter} onchange={jump}>
					{#each { length: chapterCount }, i (i)}
						<option value={i}>{i + 1}</option>
					{/each}
				</select>
				{t('reader.book.of', { count: chapterCount })}
			</label>
		{/if}
		{#if chapter < chapterCount - 1}
			<a href={bookHref(id, chapter + 1)} rel="next">{t('reader.book.next')}</a>
		{/if}
	</nav>
{/snippet}

<main class="book" class:column={book !== null && mode === 'column'}>
	<div class="reading">
		<p><a href={LIBRARY_HREF}>{t('reader.sources.back')}</a></p>

		{#if bookError}
			<p class="error" role="alert">{bookError}</p>
			<button type="button" onclick={() => loadBook(id)}>{t('reader.library.retry')}</button>
		{:else if !book}
			<p aria-live="polite">{t('reader.book.loading')}</p>
		{:else}
			<header>
				<h1 lang={book.language}>{book.title}</h1>
				{#if book.author}<p class="author" lang={book.language}>{book.author}</p>{/if}
			</header>

			<div class="toggles">
				{#if book.language === 'ja' || book.language === 'zh' || hasRuby}
					<DisplayPanel
						{display}
						hasBookRuby={hasRuby}
						{showAll}
						onchange={changeDisplay}
						ontoggleAll={() => reveal.toggleAll()}
					/>
				{/if}
				{#if book.language === 'zh'}
					<label>
						{t('reader.book.script')}
						<select bind:value={prefs.variant}>
							<option value="original">{t('reader.book.original')}</option>
							<option value="simplified">{t('reader.book.simplified')}</option>
							<option value="traditional">{t('reader.book.traditional')}</option>
						</select>
					</label>
					{#if variantError}<span class="error" role="alert">{variantError}</span>{/if}
				{/if}
			</div>

			{#if displayNotice}<p class="error" role="alert">{displayNotice}</p>{/if}
			{#if readings.failed > 0}
				<p role="status">
					{t('reader.book.readingsFailed')}
					<button type="button" onclick={() => untrack(() => void readings.run({ key: `${id}:${chapter}:${variant}`, lang: book?.language ?? '', runs: paragraphs, start: topParagraph ?? 0, display, index, want: wantOf() }))}>{t('reader.words.tryAgain')}</button>
				</p>
			{/if}

			{@render chapterNav(t('reader.book.chapters'))}

			{#if chapterError}
				<p class="error" role="alert">{chapterError}</p>
				<button type="button" onclick={() => loadChapter(id, chapter)}>{t('reader.library.retry')}</button>
			{:else if !content || content.n !== chapter}
				<p aria-live="polite">{t('reader.book.loadingChapter')}</p>
			{:else}
				<article>
					<h2 lang={content.data.title.trim() ? textLang : undefined}>
						{chapterTitle(content.data.title, content.n)}
					</h2>
					<ChapterText
						{paragraphs}
						{display}
						pieces={readings.pieces}
						words={readings.words}
						{reveal}
						{showAll}
						lang={textLang}
						{lookup}
						{marked}
						highlights={visible.drawn}
						onhighlight={editFromText}
						bind:container
					/>
				</article>
				{@render chapterNav(t('reader.book.chaptersEnd'))}
			{/if}

			<footer class="credits">
				{#if book.attribution}<p class="attribution">{book.attribution}</p>{/if}
				{#if book.licenseNote}<p>{book.licenseNote}</p>{/if}
				{#if sourceUrl}
					<p>
						{t('reader.book.source')}
						<a href={sourceUrl} target="_blank" rel="noopener noreferrer">{book.source || sourceUrl}</a>
					</p>
				{:else if book.source}
					<p>{t('reader.book.sourceNamed', { source: book.source })}</p>
				{/if}
			</footer>

			<PopupStackView {lookup} {studyWorkspaceId} {highlighter} stateLine={wordStateLine} />
			<!-- An each over at most one item: a new key is a fresh editor, and
			     the closing one keeps its own values while it is torn down. -->
			{#each editor ? [editor] : [] as open (open.key)}
				<HighlightEditor
					list={highlights}
					id={open.id}
					anchor={open.anchor}
					lang={textLang}
					focusNote={open.focusNote}
					notice={open.notice}
					initialNote={open.initialNote}
					pending={open.body !== undefined}
					failure={open.failure}
					oncolor={rememberColor}
					ondraft={(d) => (editorDraft = d)}
					onretry={(d) => void retryAdd(d)}
					onclose={(how) => void closeEditor(how)}
				/>
			{/each}
		{/if}
	</div>

	{#if book}
		<ReaderRail
			tabs={railTabs}
			active={railState.tab}
			onSelect={selectTab}
			open={railOpen}
			onToggle={toggleRail}
			{mode}
			escapeBlocked={() => lookup.info !== null}
		>
			{#snippet panel(tab: RailTab)}
				{#if tab === 'bookmarks'}
					<BookmarksPanel
						list={bookmarks}
						lang={textLang}
						titles={chapterTitles}
						onjump={jumpFromRail}
						here={hereBookmark}
						{canToggle}
						failed={bookmarksFailed}
						ontoggle={toggleBookmark}
					/>
				{:else if tab === 'words'}
					<WordsPanel
						resetKey={`${chapterKey}:${studyWorkspaceId ?? ''}`}
						cards={indexState}
						oncardsretry={retryIndex}
						lang={book?.language ?? ''}
						chapter={chapterCounted}
						progress={readings.progress}
						failed={readings.failed}
						onretry={() => untrack(() => void readings.run({ key: chapterKey, lang: book?.language ?? '', runs: paragraphs, start: topParagraph ?? 0, display, index, want: wantOf() }))}
						book={bookCounted}
						{bookProgress}
						{bookFailed}
						oncountbook={() => void countBook()}
						oncancelbook={cancelBook}
						decks={studyDecks}
						onadd={addFromPanel}
						onmark={markFromPanel}
					/>
				{:else}
					<HighlightsPanel
						list={highlights}
						lang={textLang}
						titles={chapterTitles}
						changed={changedIds}
						onjump={jumpToHighlight}
						onedit={editFromPanel}
						onretry={() => void highlights.load(id)}
					/>
				{/if}
			{/snippet}
		</ReaderRail>
	{/if}

	<!-- Outside the rail, so they are heard while it is collapsed or closed. -->
	<p class="visually-hidden" role="status" aria-live="polite">{bookmarks.announcement}</p>
	<p class="visually-hidden" role="alert">{bookmarkAlert}</p>
	<p class="visually-hidden" role="status" aria-live="polite">{highlightLive}</p>
	<p class="visually-hidden" role="alert">{highlightAlert}</p>
</main>

<style>
	.book {
		max-width: 44rem;
	}

	/* Wide screens: the text column keeps its width (44rem at most) and
	   the rail sits beside it. Collapsed, the rail is just its tab strip;
	   the page keeps its width, so the text does not move sideways. */
	.book.column {
		display: flex;
		gap: 2rem;
		align-items: flex-start;
		max-width: calc(44rem + 2rem + 18rem);
	}

	.reading {
		flex: 1 1 auto;
		min-width: 0;
		max-width: 44rem;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.author {
		margin-top: -0.5rem;
		opacity: 0.75;
	}

	.toggles,
	.chapters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.25rem;
		align-items: center;
		margin: 0.75rem 0;
	}

	.credits {
		margin-top: 2.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		font-size: 0.85rem;
		opacity: 0.8;
	}

	.credits p {
		margin: 0.25rem 0;
	}

	/* Aozora attributions are several lines (底本, 入力, 校正...). */
	.attribution {
		white-space: pre-line;
	}

	.error {
		color: #b3261e;
	}
</style>
