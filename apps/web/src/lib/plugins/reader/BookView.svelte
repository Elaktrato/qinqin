<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { record as recordEvent } from '$lib/events';
	import { workspaces } from '$lib/workspaces';
	import { createReadingTimer } from './readingTimer';
	import { workspaceForBook } from './readingWorkspace';
	import { getBook, getChapter, setPosition } from '$lib/api/library';
	import type { Book, Chapter } from '$lib/api/types';
	import ChapterText from './ChapterText.svelte';
	import PopupStackView from './PopupStackView.svelte';
	import { paragraphElement } from './dom';
	import { apiErrorMessage } from './errors';
	import { displayRuns } from './paragraphText';
	import { chapterTitle, formatPosition, type Position } from './position';
	import { restoreDecision, restorePlan } from './restore';
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

	$effect(() => void loadBook(id));
	$effect(() => void loadChapter(id, chapter));

	// --- reading position ---

	// The restore rule lives in restore.ts. It is applied once per opened
	// book; chapter navigation inside the book never restores again, and a
	// restore that cannot happen (the reader went elsewhere, the chapter
	// failed, the jump failed) is dropped rather than blocking reading.
	let restoredBook = 0;
	let restoreTo = $state<Position | null>(null);
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
		if (decision === 'skip') {
			tracking = true;
			return;
		}
		void tick().then(() => {
			if (container) paragraphElement(container, target.paragraph)?.scrollIntoView({ block: 'start' });
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
			for (const record of records) {
				const p = Number((record.target as HTMLElement).dataset.p);
				if (record.isIntersecting) visible.add(p);
				else visible.delete(p);
			}
			if (visible.size > 0) saver.schedule(bookId, formatPosition(n, Math.min(...visible)));
		});
		for (const p of el.querySelectorAll('[data-p]')) observer.observe(p);
		return () => observer.disconnect();
	});

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

<main class="book">
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
				<ChapterText {paragraphs} showRuby={prefs.furigana} lang={textLang} {lookup} bind:container />
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
