<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { record as recordEvent } from '$lib/events';
	import { workspaces } from '$lib/workspaces';
	import { createReadingTimer } from './readingTimer';
	import { workspaceForBook } from './readingWorkspace';
	import {
		addBookmark,
		deleteBookmark,
		getBook,
		getChapter,
		listBookmarks,
		renameBookmark,
		setPosition
	} from '$lib/api/library';
	import type { Book, Chapter } from '$lib/api/types';
	import BookmarksPanel from './BookmarksPanel.svelte';
	import ChapterText from './ChapterText.svelte';
	import PopupStackView from './PopupStackView.svelte';
	import { BookmarkList, bookmarkKey } from './bookmarkList.svelte';
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
	// Positions are saved only once the restore settled, so opening a book
	// never overwrites the saved place with the top of chapter 0.
	let tracking = $state(false);
	const saver = new PositionSaver(setPosition, SAVE_DELAY_MS);
	// The toolbar sticks to the top of the screen while reading (so the
	// bookmark button is at hand anywhere in a chapter): what it covers
	// does not count as in view, and restores and jumps scroll paragraphs
	// below it (scroll-margin-top in ChapterText).
	let barHeight = $state(0);

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
		focusAfterRestore = false;
		if (decision === 'skip') {
			tracking = true;
			return;
		}
		void tick().then(() => {
			const el = container && paragraphElement(container, target.paragraph);
			el?.scrollIntoView({ block: 'start' });
			// A bookmark jump moves keyboard focus to the paragraph, so the
			// next Tab continues from the text rather than the panel above.
			if (el && focus) {
				el.tabIndex = -1;
				el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
				el.focus({ preventScroll: true });
			}
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
		// What the sticky toolbar covers is not in view (else every restore,
		// which lands below the toolbar, would save the paragraph above).
		const covered = Math.ceil(barHeight);
		if (!tracking || !el || n === undefined || bookId === undefined) return;
		const visible = new Set<number>();
		const observer = new IntersectionObserver(
			(records) => {
				for (const record of records) {
					const p = Number((record.target as HTMLElement).dataset.p);
					if (record.isIntersecting) visible.add(p);
					else visible.delete(p);
				}
				if (visible.size > 0) saver.schedule(bookId, formatPosition(n, Math.min(...visible)));
			},
			{ rootMargin: `-${covered}px 0px 0px 0px` }
		);
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
		const covered = Math.ceil(barHeight);
		topParagraph = null;
		if (!el || n === undefined) return;
		const visible = new Set<number>();
		const observer = new IntersectionObserver(
			(records) => {
				for (const record of records) {
					const p = Number((record.target as HTMLElement).dataset.p);
					if (record.isIntersecting) visible.add(p);
					else visible.delete(p);
				}
				if (visible.size > 0) topParagraph = Math.min(...visible);
			},
			{ rootMargin: `-${covered}px 0px 0px 0px` }
		);
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
	const marked = $derived(content ? bookmarkedParagraphs(bookmarks.items, content.n) : new Set<number>());

	function toggleBookmark(): void {
		if (!canToggle || !here || !herePosition || !content) return;
		const label =
			snippetAt(paragraphString(paragraphs[here.paragraph] ?? [])) ||
			snippetAt(chapterTitle(content.data.title, content.n));
		void bookmarks.toggle(herePosition, label);
	}

	function isTyping(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return (
			target.isContentEditable ||
			target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
		);
	}

	$effect(() => {
		const onKey = (e: KeyboardEvent): void => {
			const popupOpen = lookup.info !== null || inPopup(e.target);
			if (!bookmarkKey(e, { typing: isTyping(e.target), popupOpen })) return;
			e.preventDefault();
			toggleBookmark();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function jumpToBookmark(b: Bookmark): void {
		const plan = jumpPlan(b.position, chapterCount, chapter);
		if (plan.kind === 'none') {
			bookmarks.error = 'This bookmark points to a place the book does not have.';
			return;
		}
		focusAfterRestore = true;
		if (plan.kind === 'scroll') {
			restoreTo = plan.target;
			return;
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
					tracking = true;
				}
			);
	}

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

<main class="book" style:--reader-bar="{barHeight}px">
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

		<div class="toggles" bind:offsetHeight={barHeight}>
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
			<button
				type="button"
				class="bookmark-toggle"
				aria-pressed={hereBookmark !== null}
				aria-disabled={!canToggle}
				aria-busy={bookmarks.saving}
				aria-keyshortcuts="B"
				title={hereBookmark
					? 'Remove the bookmark at the top of the screen (B)'
					: 'Bookmark the paragraph at the top of the screen (B)'}
				onclick={toggleBookmark}
			>
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
					<path
						d="M4 1.75h8a.75.75 0 0 1 .75.75v12l-4.75-3.2-4.75 3.2v-12A.75.75 0 0 1 4 1.75z"
						fill={hereBookmark ? 'currentColor' : 'none'}
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linejoin="round"
					/>
				</svg>
				Bookmark
			</button>
		</div>

		<BookmarksPanel
			list={bookmarks}
			lang={textLang}
			titles={chapterTitles}
			onjump={jumpToBookmark}
		/>

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

		<PopupStackView {lookup} {studyWorkspaceId} />
	{/if}
</main>

<style>
	.book {
		max-width: 44rem;
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

	/* Below the lookup popups (z-index 50+). */
	.toggles {
		position: sticky;
		top: 0;
		z-index: 2;
		padding: 0.4rem 0;
		background: Canvas;
		border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	}

	.bookmark-toggle {
		display: inline-flex;
		gap: 0.35rem;
		align-items: center;
		font: inherit;
	}

	.bookmark-toggle[aria-pressed='true'] svg {
		color: #0b6bcb;
	}

	.bookmark-toggle[aria-disabled='true'] {
		opacity: 0.6;
		cursor: default;
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
