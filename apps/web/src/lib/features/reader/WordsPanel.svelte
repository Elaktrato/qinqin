<script lang="ts">
	import { t } from '$lib/i18n';
	import { errorMessage } from '$lib/stats/errors';
	import { formatPercent } from '$lib/i18n/format';
	import { Stat } from '$lib/ui';
	import type { Deck } from '$lib/study/types';
	import type { Coverage, UnknownItem } from './coverage';
	import { allNew, type AddWordsResult } from './wordActions';
	import {
		PAGE_SIZE,
		addResultText,
		bookProgressText,
		buttonLabels,
		countingText,
		coverageText,
		deckOptions,
		figuresText,
		markResultText,
		pageOf,
		unmatchedText,
		wordCountsSupported
	} from './wordsPanel';

	// The side rail's Words tab (#68): chapter (and, on demand, book)
	// coverage and the unknown words by frequency, with bulk add and "I know
	// these". Thin: texts come from wordsPanel.ts, the writes from the
	// callbacks (BookView wires them to wordActions.ts in the book's workspace).
	type Counted = { coverage: Coverage; list: UnknownItem[] };
	let {
		resetKey,
		cards,
		oncardsretry,
		lang,
		chapter,
		progress,
		failed,
		onretry,
		book,
		bookProgress,
		bookFailed,
		oncountbook,
		oncancelbook,
		decks,
		onadd,
		onmark
	}: {
		/** Book, chapter, variant and workspace: a change drops the selection, result and Undo. */
		resetKey: string;
		/** The learner's cards and marks (the known index): figures and actions wait for them. */
		cards: 'loading' | 'ready' | 'error';
		oncardsretry: () => void;
		lang: string;
		/** The open chapter, once every part is counted. */
		chapter: Counted | null;
		progress: { done: number; total: number };
		/** Chunks that could not be counted. */
		failed: number;
		onretry: () => void;
		/** The whole book, once every chapter is counted. */
		book: Counted | null;
		/** Set while the book is being counted. */
		bookProgress: { done: number; total: number } | null;
		/** Chapters the last book count could not count. */
		bookFailed: number;
		oncountbook: () => void;
		oncancelbook: () => void;
		decks: Deck[];
		onadd: (ids: number[], target: { id: string; name: string }) => Promise<AddWordsResult>;
		onmark: (ids: number[]) => Promise<{ written: number[]; undo: () => Promise<void> }>;
	} = $props();

	const id = $props.id();
	let scope = $state<'chapter' | 'book'>('chapter');
	let pages = $state(1);
	let selected = $state<Set<number>>(new Set());
	let deckId = $state('general');
	let busy = $state(false);
	let result = $state('');
	let error = $state('');
	let undo = $state<(() => Promise<void>) | null>(null);

	const current = $derived(scope === 'book' && book !== null ? book : chapter);
	const list = $derived(current?.list ?? []);
	const page = $derived(pageOf(list, pages));
	const newIds = $derived(allNew(list));
	const options = $derived(deckOptions(decks));
	const target = $derived(options.find((d) => d.id === deckId) ?? options[0]);
	// Only words still in the list count (one may have become known meanwhile).
	const chosen = $derived(list.filter((w) => selected.has(w.entryId)).map((w) => w.entryId));
	const labels = $derived(buttonLabels(chosen.length, newIds.length));

	// Another chapter or book (the page is reused): nothing carries over, so
	// nothing is ever written into the new book's workspace by mistake.
	let lastKey = '';
	$effect.pre(() => {
		const key = resetKey;
		if (key === lastKey) return;
		lastKey = key;
		selected = new Set();
		pages = 1;
		scope = 'chapter';
		result = '';
		error = '';
		undo = null;
	});

	$effect(() => {
		if (book === null && scope === 'book') scope = 'chapter';
	});

	function toggle(entryId: number, on: boolean): void {
		const next = new Set(selected);
		if (on) next.add(entryId);
		else next.delete(entryId);
		selected = next;
	}

	async function act(run: () => Promise<void>): Promise<void> {
		busy = true;
		error = '';
		result = '';
		undo = null;
		try {
			await run();
		} catch (err) {
			error = errorMessage(err, t('reader.words.saveFailed'));
		} finally {
			busy = false;
		}
	}

	const add = (ids: number[]) =>
		act(async () => {
			const into = target;
			const key = lastKey;
			const res = await onadd(ids, into);
			if (key !== lastKey) return; // the reader moved on meanwhile
			result = addResultText(res, into.name);
			selected = new Set();
		});

	const mark = () =>
		act(async () => {
			const key = lastKey;
			const res = await onmark(chosen);
			if (key !== lastKey) return;
			result = markResultText(res.written.length);
			selected = new Set();
			if (res.written.length > 0) undo = res.undo;
		});

	function runUndo(): Promise<void> {
		const u = undo;
		return act(async () => {
			if (u) await u();
			result = t('reader.words.undone');
		});
	}
</script>

<!-- A coverage figure (design §9): a large light number with its sentence
     read first, and a 3px accent bar showing the share. -->
{#snippet figure(c: Coverage, scope: 'chapter' | 'book')}
	{#if c.percent === null}
		<p class="figure">{coverageText(c, scope)}</p>
	{:else}
		<Stat value={formatPercent(c.percent / 100)} label={coverageText(c, scope)} />
		<div class="coverage-bar" aria-hidden="true"><i style:width="{Math.max(0, Math.min(100, c.percent))}%"></i></div>
	{/if}
{/snippet}

<h2>{t('reader.words.title')}</h2>
{#if !wordCountsSupported(lang)}
	<p class="hint">{t('reader.words.unsupported')}</p>
{:else if cards === 'loading'}
	<p class="hint" role="status">{t('reader.words.loadingCards')}</p>
{:else if cards === 'error'}
	<p class="error">
		{t('reader.words.cardsFailed')}
		<button type="button" onclick={oncardsretry}>{t('reader.words.tryAgain')}</button>
	</p>
{:else}
	<section aria-labelledby="{id}-chapter">
		<h3 id="{id}-chapter">{t('reader.words.thisChapter')}</h3>
		{#if chapter !== null}
			{@render figure(chapter.coverage, 'chapter')}
			<p class="hint">{figuresText(chapter.coverage)}</p>
			{#if unmatchedText(chapter.coverage.unmatched)}<p class="hint">{unmatchedText(chapter.coverage.unmatched)}</p>{/if}
		{:else if failed > 0}
			<p class="error">
				{t('reader.words.partsFailed')}
				<button type="button" onclick={onretry}>{t('reader.words.tryAgain')}</button>
			</p>
		{:else}
			<p class="hint" role="status">{countingText(progress.done, progress.total)}</p>
		{/if}
	</section>

	<section aria-labelledby="{id}-book">
		<h3 id="{id}-book">{t('reader.words.book')}</h3>
		{#if bookProgress !== null}
			<p class="hint" role="status">{bookProgressText(bookProgress.done, bookProgress.total)}</p>
			<button type="button" onclick={oncancelbook}>{t('common.action.cancel')}</button>
		{:else if book !== null}
			{@render figure(book.coverage, 'book')}
			<p class="hint">{figuresText(book.coverage)}</p>
		{:else}
			{#if bookFailed > 0}<p class="error">{t('reader.words.chaptersFailed', { count: bookFailed })}</p>{/if}
			<button type="button" onclick={oncountbook}>{t('reader.words.countBook')}</button>
		{/if}
	</section>

	{#if book !== null}
		<fieldset class="scope">
			<legend>{t('reader.words.wordsOf')}</legend>
			<label><input type="radio" name="{id}-scope" value="chapter" bind:group={scope} /> {t('reader.words.thisChapter')}</label>
			<label><input type="radio" name="{id}-scope" value="book" bind:group={scope} /> {t('reader.words.wholeBook')}</label>
		</fieldset>
	{/if}

	{#if list.length > 0}
		<ul class="words">
			{#each page.shown as w (w.entryId)}
				<li>
					<label
						><input
							type="checkbox"
							checked={selected.has(w.entryId)}
							onchange={(e) => toggle(w.entryId, e.currentTarget.checked)}
						/><span class={w.state === 'new' ? 'w-new w-end' : 'w-learning w-end'}>{w.lemma}</span></label
					>
					{#if w.reading}<span class="reading">{w.reading}</span>{/if}
					<span class="count">×{w.count}</span>
					<span class="state">{w.state === 'new' ? t('reader.words.stateNew') : t('reader.words.stateLearning')}</span>
				</li>
			{/each}
		</ul>
		{#if page.more}<button type="button" onclick={() => (pages += 1)}>{t('reader.words.showMore', { count: PAGE_SIZE })}</button>{/if}

		<div class="actions">
			<label for="{id}-deck">{t('reader.words.deck')}</label>
			<select id="{id}-deck" bind:value={deckId}>
				{#each options as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
			</select>
			<button type="button" disabled={busy || chosen.length === 0} onclick={() => add(chosen)}>{labels.addSelected}</button>
			<button type="button" disabled={busy || newIds.length === 0} onclick={() => add(newIds)}>{labels.addAll}</button>
			<button type="button" disabled={busy || chosen.length === 0} onclick={mark}>{labels.know}</button>
		</div>
	{:else if current !== null}
		<p class="hint">{t('reader.words.noneUnknown')}</p>
	{/if}
	<p role="status" aria-live="polite">
		{result}
		{#if undo}<button type="button" class="link" onclick={runUndo}>{t('reader.words.undo')}</button>{/if}
	</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
	/* A rail panel (design §5): no boxes; small headings; hairline rows. */
	h2 {
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
		margin: 0 0 var(--space-3);
	}
	h3 {
		font-size: var(--font-size-xs);
		font-weight: var(--weight-strong);
		color: var(--readable-muted);
		margin: var(--space-4) 0 var(--space-1);
	}
	section :global(.stat .value) {
		font-size: var(--font-size-xl);
	}
	.coverage-bar {
		height: 3px;
		margin: var(--space-2) 0;
		border-radius: 3px;
		background: var(--raised);
		overflow: hidden;
	}
	.coverage-bar i {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.figure {
		margin: var(--space-1) 0;
		font-weight: var(--weight-medium);
	}
	.hint {
		margin: var(--space-1) 0;
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
	}
	.error {
		margin: var(--space-2) 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
	.scope {
		border: 0;
		padding: 0;
		margin: var(--space-3) 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
	}
	.words {
		list-style: none;
		margin: var(--space-3) 0;
		padding: 0;
	}
	.words li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		min-height: 2rem;
		padding: var(--space-1) 0;
	}
	.words li + li {
		border-top: 1px solid var(--hair);
	}
	.words label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-hanzi);
		font-size: var(--font-size-m);
	}
	.reading,
	.count,
	.state {
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
	}
	.count {
		margin-inline-start: auto;
		font-variant-numeric: tabular-nums;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.actions select,
	.actions button {
		min-height: 2rem;
	}
</style>
