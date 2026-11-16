<script lang="ts">
	import { errorMessage } from '$lib/stats/errors';
	import type { Deck } from '$lib/study/types';
	import type { Coverage, UnknownItem } from './coverage';
	import { allNew, type AddWordsResult } from './wordActions';
	import {
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
			error = errorMessage(err, 'Could not save. Try again.');
		} finally {
			busy = false;
		}
	}

	const add = (ids: number[]) =>
		act(async () => {
			const t = target;
			const key = lastKey;
			const res = await onadd(ids, t);
			if (key !== lastKey) return; // the reader moved on meanwhile
			result = addResultText(res, t.name);
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
			result = 'Undone: the words are no longer marked as known';
		});
	}
</script>

<h2>Words</h2>
{#if !wordCountsSupported(lang)}
	<p class="hint">Word counts are available for Chinese and Japanese books</p>
{:else if cards === 'loading'}
	<p class="hint" role="status">Loading your cards…</p>
{:else if cards === 'error'}
	<p class="error">Could not load your cards, so the words you know cannot be counted. <button type="button" onclick={oncardsretry}>Try again</button></p>
{:else}
	<section aria-labelledby="{id}-chapter">
		<h3 id="{id}-chapter">This chapter</h3>
		{#if chapter !== null}
			<p class="figure">{coverageText(chapter.coverage, 'chapter')}</p>
			<p class="hint">{figuresText(chapter.coverage)}</p>
			{#if unmatchedText(chapter.coverage.unmatched)}<p class="hint">{unmatchedText(chapter.coverage.unmatched)}</p>{/if}
		{:else if failed > 0}
			<p class="error">Some parts could not be counted. <button type="button" onclick={onretry}>Try again</button></p>
		{:else}
			<p class="hint" role="status">{countingText(progress.done, progress.total)}</p>
		{/if}
	</section>

	<section aria-labelledby="{id}-book">
		<h3 id="{id}-book">Book</h3>
		{#if bookProgress !== null}
			<p class="hint" role="status">{bookProgressText(bookProgress.done, bookProgress.total)}</p>
			<button type="button" onclick={oncancelbook}>Cancel</button>
		{:else if book !== null}
			<p class="figure">{coverageText(book.coverage, 'book')}</p>
			<p class="hint">{figuresText(book.coverage)}</p>
		{:else}
			{#if bookFailed > 0}<p class="error">{bookFailed} chapters could not be counted.</p>{/if}
			<button type="button" onclick={oncountbook}>Count the whole book</button>
		{/if}
	</section>

	{#if book !== null}
		<fieldset class="scope">
			<legend>Words of</legend>
			<label><input type="radio" name="{id}-scope" value="chapter" bind:group={scope} /> This chapter</label>
			<label><input type="radio" name="{id}-scope" value="book" bind:group={scope} /> Whole book</label>
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
						/>{w.lemma}</label
					>
					{#if w.reading}<span class="reading">{w.reading}</span>{/if}
					<span class="count">×{w.count}</span>
					<span class="chip {w.state}">{w.state === 'new' ? 'New' : 'Learning'}</span>
				</li>
			{/each}
		</ul>
		{#if page.more}<button type="button" onclick={() => (pages += 1)}>Show 50 more</button>{/if}

		<div class="actions">
			<label for="{id}-deck">Deck</label>
			<select id="{id}-deck" bind:value={deckId}>
				{#each options as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
			</select>
			<button type="button" disabled={busy || chosen.length === 0} onclick={() => add(chosen)}>{labels.addSelected}</button>
			<button type="button" disabled={busy || newIds.length === 0} onclick={() => add(newIds)}>{labels.addAll}</button>
			<button type="button" disabled={busy || chosen.length === 0} onclick={mark}>{labels.know}</button>
		</div>
	{:else if current !== null}
		<p class="hint">No unknown words here.</p>
	{/if}
	<p role="status" aria-live="polite">
		{result}
		{#if undo}<button type="button" class="link" onclick={runUndo}>Undo</button>{/if}
	</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
	h2 {
		font-size: 1rem;
		margin: 0.25rem 0 0.6rem;
	}
	h3 {
		font-size: 0.9rem;
		margin: 0.6rem 0 0.2rem;
	}
	.figure {
		margin: 0.2rem 0;
		font-weight: 600;
	}
	.hint {
		margin: 0.2rem 0;
		font-size: 0.85rem;
	}
	.error {
		margin: 0.35rem 0;
		color: #c62828;
	}
	.scope {
		border: 0;
		padding: 0;
		margin: 0.5rem 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
	}
	.words {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
	}
	.words li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0.5rem;
		min-height: 2rem;
	}
	.words label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.reading,
	.count {
		font-size: 0.85rem;
	}
	.chip {
		font-size: 0.75rem;
		padding: 0 0.4rem;
		border-radius: 0.6rem;
		border: 1px solid currentColor;
	}
	.chip.new {
		border-style: solid;
	}
	.chip.learning {
		border-style: dotted;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.actions select,
	.actions button {
		min-height: 2rem;
	}
</style>
