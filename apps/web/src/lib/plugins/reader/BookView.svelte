<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { record as recordEvent } from '$lib/events';
	import { workspaces } from '$lib/workspaces';
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
		updateHighlight
	} from '$lib/api/library';
	import type { Book, Chapter } from '$lib/api/types';
	import BookmarksPanel from './BookmarksPanel.svelte';
	import ChapterText from './ChapterText.svelte';
	import HighlightEditor from './HighlightEditor.svelte';
	import HighlightsPanel from './HighlightsPanel.svelte';
	import { HighlightList } from './highlightList.svelte';
	import { visibleHighlights, type Highlight, type HighlightColor } from './highlights';
	import {
		CLAMP_NOTICE,
		OVERLAP_NOTICE,
		TOO_LONG_NOTICE,
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
	import { browserStorage, loadPrefs, savePrefs } from './prefs';
	import { LIBRARY_HREF, bookHref, safeHttpUrl } from './route';
	import { LookupController } from './useLookup.svelte';
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

	$effect(() => savePrefs(browserStorage(), { furigana: prefs.furigana, variant: prefs.variant }));

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
				if (wanted === wantedVariant) variantError = 'Could not load the script converter.';
			}
		);
	});
	const paragraphs = $derived(content ? content.data.paragraphs.map((p) => displayRuns(p, variant)) : []);
	const hasRuby = $derived(content?.data.paragraphs.some((p) => p.some((run) => run.ruby)) ?? false);
	// zh-Hans/zh-Hant pick the right glyph forms in fonts covering both.
	const textLang = $derived(
		book?.language === 'zh' && variant !== 'original'
			? variant === 'simplified'
				? 'zh-Hans'
				: 'zh-Hant'
			: (book?.language ?? '')
	);
	const chapterCount = $derived(book?.chapterCount ?? 0);
	const sourceUrl = $derived(safeHttpUrl(book?.sourceUrl ?? ''));
	// Words looked up in the book are added to study in the book's workspace.
	const studyWorkspaceId = $derived(
		book ? workspaceForBook(book, $workspaces.list, $workspaces.current) : null
	);

	const lookup = new LookupController({
		container: () => container,
		lang: () => book?.language ?? '',
		textLang: () => textLang,
		runsOf: (p) => paragraphs[p]
	});
	$effect(() => lookup.attach());
	// The text under a popup is re-rendered (chapter, script or furigana
	// change): drop the popup rather than leave it pointing at nothing.
	$effect(() => {
		void paragraphs;
		void prefs.furigana;
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
		if (!jumpTo(b.position)) bookmarks.error = 'This bookmark points to a place the book does not have.';
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
		focusNote: boolean;
		notice: string;
	}
	let editor = $state<EditorState | null>(null);
	let editorKey = 0;

	function markOf(hid: number): HTMLElement | null {
		return container?.querySelector<HTMLElement>(`mark[data-h="${hid}"]`) ?? null;
	}

	async function openEditor(
		hid: number,
		opts: { anchor?: HTMLElement | null; returnTo?: HTMLElement | null; focusNote?: boolean; notice?: string } = {}
	): Promise<void> {
		await tick();
		const h = highlights.get(hid);
		if (!h) return;
		const mark = markOf(h.id) ?? markOf(hid);
		const anchor = opts.anchor ?? mark ?? (container && paragraphElement(container, h.paragraph));
		if (!anchor) return;
		editor = {
			key: ++editorKey,
			id: hid,
			anchor,
			returnTo: opts.returnTo === undefined ? mark : opts.returnTo,
			focusNote: opts.focusNote ?? false,
			notice: opts.notice ?? ''
		};
	}

	function closeEditor(how: { deleted: boolean; refocus: boolean }): void {
		const closing = editor;
		editor = null;
		if (!closing || !how.refocus) return;
		const back = closing.returnTo;
		if (back?.isConnected) {
			focusQuietly(back);
			return;
		}
		// The highlight is gone: the panel heading (opened from the panel)
		// or its paragraph (opened from the text).
		const heading = document.getElementById('highlights-heading');
		if (back && heading?.isConnected && heading.getClientRects().length > 0) {
			heading.focus({ preventScroll: true });
			return;
		}
		const paragraph = container && closing.anchor.closest<HTMLElement>('[data-p]');
		if (paragraph?.isConnected) focusQuietly(paragraph);
	}

	// Another chapter or book: the editor's highlight is not on screen.
	$effect(() => {
		void content?.n;
		void openBookId;
		untrack(() => (editor = null));
	});

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
			tell(highlightsFailed ? highlights.loadError : 'Highlights are still loading.');
			return;
		}
		const runs = span ? paragraphs[span.p] : undefined;
		const plan = planHighlight(span, runs ? paragraphString(runs) : null, content.n, color, highlights.items);
		if (plan.kind === 'none') {
			tell('Select some text in the book to highlight it.');
			return;
		}
		if (plan.kind === 'tooLong') {
			tell(TOO_LONG_NOTICE);
			return;
		}
		// The new colour shows on the text, not under the selection.
		window.getSelection()?.removeAllRanges();
		if (plan.kind === 'existing') {
			if (plan.exact && !withNote) {
				rememberColor(color);
				tell(plan.clamped ? CLAMP_NOTICE : '');
				void highlights.update(plan.highlight.id, { color });
				return;
			}
			tell(plan.exact ? '' : OVERLAP_NOTICE);
			lookup.close();
			await openEditor(plan.highlight.id, { focusNote: withNote, notice: plan.exact ? '' : OVERLAP_NOTICE });
			return;
		}
		rememberColor(color);
		tell(plan.clamped ? CLAMP_NOTICE : '');
		const body = plan.body;
		const adding = highlights.add(body);
		if (withNote) {
			// The editor replaces the popup. The new highlight shows at once
			// (a temporary id until it is saved; the editor follows it).
			lookup.close();
			const temp = highlights.items.find(
				(h) => h.id < 0 && h.chapter === body.chapter && h.paragraph === body.paragraph && h.start === body.start
			);
			if (temp) await openEditor(temp.id, { focusNote: true, notice: plan.clamped ? CLAMP_NOTICE : '' });
		}
		const result = await adding;
		if (!result.ok && result.existingId !== undefined && result.available) {
			tell(OVERLAP_NOTICE);
			lookup.close();
			await openEditor(result.existingId, { focusNote: withNote, notice: OVERLAP_NOTICE });
		}
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
		void openEditor(hid, { anchor: mark, returnTo: mark });
	}

	function editFromPanel(h: Highlight, opener: HTMLElement): void {
		void openEditor(h.id, { anchor: opener, returnTo: opener });
	}

	function jumpToHighlight(h: Highlight): void {
		if (mode === 'drawer') drawerOpen = false;
		focusMark = h.id;
		if (!jumpTo(formatPosition(h.chapter, h.paragraph))) {
			focusMark = null;
			highlights.error = 'This highlight points to a place the book does not have.';
		}
	}

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
		{ id: 'bookmarks' as const, label: 'Bookmarks', alert: bookmarksFailed || bookmarks.error !== '' },
		{ id: 'highlights' as const, label: 'Highlights', alert: highlightsFailed || highlights.error !== '' }
	]);
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
				void recordEvent('read', workspaceId, { bookId, seconds });
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
			<a href={bookHref(id, chapter - 1)} rel="prev">← Previous</a>
		{/if}
		{#if chapterCount > 1}
			<label>
				Chapter
				<select value={chapter} onchange={jump}>
					{#each { length: chapterCount }, i (i)}
						<option value={i}>{i + 1}</option>
					{/each}
				</select>
				of {chapterCount}
			</label>
		{/if}
		{#if chapter < chapterCount - 1}
			<a href={bookHref(id, chapter + 1)} rel="next">Next →</a>
		{/if}
	</nav>
{/snippet}

<main class="book" class:column={book !== null && mode === 'column'}>
	<div class="reading">
		<p><a href={LIBRARY_HREF}>Back to library</a></p>

		{#if bookError}
			<p class="error" role="alert">{bookError}</p>
			<button type="button" onclick={() => loadBook(id)}>Retry</button>
		{:else if !book}
			<p aria-live="polite">Loading book…</p>
		{:else}
			<header>
				<h1 lang={book.language}>{book.title}</h1>
				{#if book.author}<p class="author" lang={book.language}>{book.author}</p>{/if}
			</header>

			<div class="toggles">
				{#if book.language === 'ja' || hasRuby}
					<label><input type="checkbox" bind:checked={prefs.furigana} /> Furigana</label>
				{/if}
				{#if book.language === 'zh'}
					<label>
						Script
						<select bind:value={prefs.variant}>
							<option value="original">Original</option>
							<option value="simplified">Simplified</option>
							<option value="traditional">Traditional</option>
						</select>
					</label>
					{#if variantError}<span class="error" role="alert">{variantError}</span>{/if}
				{/if}
			</div>

			{@render chapterNav('Chapters')}

			{#if chapterError}
				<p class="error" role="alert">{chapterError}</p>
				<button type="button" onclick={() => loadChapter(id, chapter)}>Retry</button>
			{:else if !content || content.n !== chapter}
				<p aria-live="polite">Loading chapter…</p>
			{:else}
				<article>
					<h2 lang={content.data.title.trim() ? textLang : undefined}>
						{chapterTitle(content.data.title, content.n)}
					</h2>
					<ChapterText
						{paragraphs}
						showRuby={prefs.furigana}
						lang={textLang}
						{lookup}
						{marked}
						highlights={visible.drawn}
						onhighlight={editFromText}
						bind:container
					/>
				</article>
				{@render chapterNav('Chapters (end)')}
			{/if}

			<footer class="credits">
				{#if book.attribution}<p class="attribution">{book.attribution}</p>{/if}
				{#if book.licenseNote}<p>{book.licenseNote}</p>{/if}
				{#if sourceUrl}
					<p>
						Source:
						<a href={sourceUrl} target="_blank" rel="noopener noreferrer">{book.source || sourceUrl}</a>
					</p>
				{:else if book.source}
					<p>Source: {book.source}</p>
				{/if}
			</footer>

			<PopupStackView {lookup} {studyWorkspaceId} {highlighter} />
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
					oncolor={rememberColor}
					onclose={closeEditor}
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
