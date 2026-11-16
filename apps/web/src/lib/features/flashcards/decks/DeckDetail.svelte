<script lang="ts">
	import { readingBeside } from '$lib/entry/displayForm';
	import { goto } from '$app/navigation';
	import { onDestroy, tick, untrack } from 'svelte';
	import { loadEntryBases } from '$lib/api/entryBases';
	import type { EntryBase } from '$lib/api/types';
	import type { Deck } from '$lib/study/types';
	import { WORD_STATES, type WordState } from '$lib/stats/wordStates';
	import { createCardActions, type CardActionsState } from '$lib/study/cardActions';
	import { enabledKinds } from '$lib/study/deckSettings';
	import { loadConfig, saveConfig } from '$lib/study/session';
	import {
		GENERAL_DECK_ID,
		deleteCards,
		dropSiblingCards,
		moveCards,
		restoreCards,
		skipKind,
		unskipKind
	} from '$lib/study/store';
	import { CARD_KINDS, OPT_IN_KINDS, type StudyCardKind } from '$lib/study/types';
	import { workspaces } from '$lib/workspaces';
	import { flashcardsHref } from '../route';
	import {
		PAGE_SIZE,
		deckRows,
		filterRows,
		visibleCount,
		type DeckRow,
		type RowQuery
	} from './deckRows';
	import { copiedFrom } from './systemDecks';
	import { deckNumbers } from './deckStats';
	import { createDecksData } from './decksData.svelte';
	import { onContextStale } from '$lib/study/currentContext';
	import { deckLeftText } from '$lib/study/limitsText';
	import { limitsLeftToday } from './DeckLimitsSlot';
	import { deckSessionConfig, sessionKinds } from './studyStart';

	let { deckId }: { deckId: string } = $props();

	const store = createDecksData();
	const workspaceId = $derived($workspaces.current?.id ?? null);
	$effect(() => {
		void store.load(workspaceId);
	});
	// A new learner day (or zone) changes what is due and on vacation.
	$effect(() => onContextStale(() => void store.load(workspaceId)));

	const KIND_LABEL: Record<StudyCardKind, string> = {
		vocab: 'Vocab',
		sentence: 'Word Salad',
		writing: 'Writing',
		tone: 'Tone',
		reverse: 'Reverse',
		cloze: 'Cloze'
	};

	const data = $derived(store.data);
	const deck = $derived(
		data === null
			? null
			: deckId === GENERAL_DECK_ID
				? ({ id: GENERAL_DECK_ID, name: 'General' } as Deck)
				: (data.decks.find((d) => d.id === deckId) ?? null)
	);
	const enabled = $derived(data === null ? new Set<never>() : enabledKinds(data.deckSettings, [deckId]));

	// ---- entry bases: visible rows first, then the rest ------------------------------------------
	let bases = $state.raw<ReadonlyMap<number, EntryBase>>(new Map());
	let basesFailed = $state(false);
	let basesSeq = 0;
	const entryIds = $derived.by(() => {
		if (data === null) return [] as number[];
		const ids = new Set<number>();
		for (const card of data.cards) if (card.deckIds.includes(deckId)) ids.add(card.entryId);
		return [...ids].sort((a, b) => a - b);
	});

	async function loadBases(ids: number[]): Promise<void> {
		const mine = ++basesSeq;
		basesFailed = false;
		if (ids.length === 0) return;
		const merge = (map: Map<number, EntryBase>): void => {
			if (mine === basesSeq) bases = new Map([...untrack(() => bases), ...map]);
		};
		try {
			const first = ids.slice(0, PAGE_SIZE);
			merge(await loadEntryBases(first));
			if (ids.length > first.length) merge(await loadEntryBases(ids, { priority: first }));
		} catch {
			if (mine === basesSeq) basesFailed = true;
		}
	}
	$effect(() => {
		const ids = entryIds;
		untrack(() => void loadBases(ids));
	});

	// ---- rows, search, filters --------------------------------------------------------------------
	const rows = $derived(
		data === null ? [] : deckRows(data.cards, deckId, data.index, bases)
	);
	let text = $state('');
	let applied = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let stateFilter = $state<WordState | 'all'>('all');
	let kind = $state<StudyCardKind | 'all'>('all');
	let dueNow = $state(false);
	let sort = $state<RowQuery['sort']>('added');
	let pages = $state(1);

	function onSearch(value: string): void {
		text = value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => (applied = value), 150);
	}

	const query = $derived<RowQuery>({ text: applied, state: stateFilter, kind, dueNow, sort });
	const filtered = $derived(filterRows(rows, query, data?.now ?? new Date()));
	// A new query starts at the first page again.
	$effect(() => {
		void query;
		pages = 1;
	});
	const shown = $derived(filtered.slice(0, visibleCount(filtered.length, pages)));
	const remaining = $derived(filtered.length - shown.length);

	const leftText = $derived(
		data === null || limitsLeftToday === null
			? null
			: deckLeftText(
					limitsLeftToday(deckId, data, sessionKinds(data.workspaceId, [deckId], data.deckSettings))
				)
	);

	const numbers = $derived(
		data === null || deck === null
			? null
			: deckNumbers({
					...data,
					w: data.weights,
					deckId,
					kinds: sessionKinds(data.workspaceId, [deckId], data.deckSettings)
				})
	);

	// ---- selection and card management ------------------------------------------------------------
	let selected = $state<number[]>([]);
	let target = $state('');
	let confirming = $state(false);
	let confirmingMove = $state(false);
	let expanded = $state<number[]>([]);
	let root: HTMLElement | undefined = $state();

	const chosen = $derived(selected.filter((id) => filtered.some((row) => row.entryId === id)));
	const allChosen = $derived(filtered.length > 0 && chosen.length === filtered.length);
	$effect(() => {
		void chosen.length;
		confirming = false;
		confirmingMove = false;
	});

	const actions = createCardActions({
		deleteCards,
		moveCards,
		restoreCards,
		dropSiblingCards,
		skipKind,
		unskipKind,
		onchanged: () => store.load(untrack(() => workspaceId), true)
	});
	let controller = $state<CardActionsState>({ busy: false, error: '', undo: null });
	const unsubscribe = actions.state.subscribe((next) => (controller = next));
	onDestroy(() => {
		unsubscribe();
		actions.destroy();
		clearTimeout(searchTimer);
	});

	/** The cards a row's delete/move acts on: its word, or every remaining card when the word is gone. */
	function rowIds(row: DeckRow): string[] {
		return row.vocab !== null ? [row.vocab.id] : row.siblings.map((card) => card.id);
	}

	const moveTargets = $derived(
		data === null
			? []
			: [{ id: GENERAL_DECK_ID, name: 'General' }, ...data.decks].filter((d) => d.id !== deckId)
	);

	function idsOf(entryIds: number[]): string[] {
		return rows.filter((row) => entryIds.includes(row.entryId)).flatMap(rowIds);
	}

	function toggleAll(): void {
		selected = allChosen ? [] : filtered.map((row) => row.entryId);
	}

	async function focusRow(index: number): Promise<void> {
		await tick();
		const inputs = root?.querySelectorAll<HTMLInputElement>('.rows .pick');
		if (inputs !== undefined && inputs.length > 0) inputs[Math.min(index, inputs.length - 1)].focus();
		else root?.querySelector<HTMLElement>('h1')?.focus();
	}

	async function remove(): Promise<void> {
		const entries = [...chosen];
		const index = Math.min(...entries.map((id) => filtered.findIndex((r) => r.entryId === id)).filter((i) => i >= 0));
		confirming = false;
		await actions.remove(idsOf(entries));
		selected = selected.filter((id) => !entries.includes(id));
		await focusRow(Number.isFinite(index) ? index : 0);
	}

	const targetName = $derived(moveTargets.find((d) => d.id === target)?.name ?? target);

	function openMoveConfirm(): void {
		if (target === '' || chosen.length === 0) return;
		confirming = false;
		confirmingMove = true;
		void tick().then(() => root?.querySelector<HTMLElement>('.confirm-move .secondary')?.focus());
	}

	async function move(): Promise<void> {
		if (target === '' || chosen.length === 0) return;
		const entries = [...chosen];
		const index = Math.min(...entries.map((id) => filtered.findIndex((r) => r.entryId === id)).filter((i) => i >= 0));
		confirmingMove = false;
		await actions.move(idsOf(entries), target, targetName);
		selected = [];
		await focusRow(Number.isFinite(index) ? index : 0);
	}

	function openConfirm(): void {
		confirmingMove = false;
		confirming = true;
		void tick().then(() => root?.querySelector<HTMLElement>('.confirm .secondary')?.focus());
	}

	function confirmKey(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.stopPropagation();
			confirming = false;
			confirmingMove = false;
		}
	}

	function study(): void {
		if (data === null) return;
		saveConfig(
			deckSessionConfig(loadConfig(), deckId, sessionKinds(data.workspaceId, [deckId], data.deckSettings))
		);
		void goto('/study/session');
	}

	function siblingIds(row: DeckRow, k: StudyCardKind): string[] {
		return row.siblings.filter((card) => card.kind === k).map((card) => card.id);
	}

	function chips(row: DeckRow): { kind: StudyCardKind; off: boolean }[] {
		const out: { kind: StudyCardKind; off: boolean }[] = [];
		for (const k of CARD_KINDS) {
			if (k === 'vocab') continue;
			if (row.skipped.includes(k) && siblingIds(row, k).length === 0) out.push({ kind: k, off: true });
			else if (siblingIds(row, k).length > 0) out.push({ kind: k, off: false });
		}
		return out;
	}

	function toggleNum(list: readonly number[], id: number): number[] {
		return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
	}

	const MOVE_NOTE =
		'Moves the word out of every other deck too, with its other cards. You can undo this right after.';

	function plural(n: number, one: string): string {
		return `${n} ${n === 1 ? one : `${one}s`}`;
	}

	function dueText(row: DeckRow): string {
		if (row.nextDue === null || data === null) return '—';
		return data.ctx.day.dayOf(Date.parse(row.nextDue));
	}
</script>

<div bind:this={root}>
	{#if store.status === 'loading'}
		<p role="status">Loading deck…</p>
	{:else if store.status === 'no-workspace'}
		<p role="status">Choose a workspace in the header to see your decks.</p>
	{:else if store.status === 'error'}
		<p role="alert">{store.error}</p>
		<button type="button" onclick={() => void store.load(workspaceId, true)}>Try again</button>
	{:else if deck === null || numbers === null}
		<p role="status">Deck not found.</p>
		<a href={flashcardsHref({ view: 'list' })}>Back to decks</a>
	{:else}
		<p class="back"><a href={flashcardsHref({ view: 'list' })}>‹ Decks</a></p>
		<h1 tabindex="-1">{deck.name}</h1>
		{#if deck.source !== undefined}
			<p class="source">
				Copied from {copiedFrom(deck.source)}
			</p>
		{/if}
		<section class="numbers" aria-label={`${deck.name} numbers`}>
			<p>
				{plural(numbers.words, 'word')} · {plural(numbers.cards, 'card')} ·
				{#if data?.ctx.vacationToday}On vacation{:else}{numbers.due} due · {numbers.fresh} new{/if} ·
				{numbers.studied} studied · {numbers.mastered} mastered
			</p>
			{#if leftText !== null && !data?.ctx.vacationToday}
				<p class="left">{leftText}</p>
			{/if}
			<div class="actions">
				<button type="button" class="primary" onclick={study}>Study</button>
				<a href={flashcardsHref({ view: 'settings', deckId })}>Settings</a>
			</div>
		</section>

		{#if rows.length === 0}
			<p class="hint">No cards in this deck yet.</p>
		{:else}
			<div class="filters">
				<label>
					Search words
					<input
						type="search"
						aria-label="Search words"
						value={text}
						oninput={(e) => onSearch(e.currentTarget.value)}
						placeholder="Word, reading or id"
					/>
				</label>
				<label>
					State
					<select bind:value={stateFilter}>
						<option value="all">All</option>
						{#each WORD_STATES as s (s.state)}
							<option value={s.state}>{s.label}</option>
						{/each}
					</select>
				</label>
				<label>
					Kind
					<select bind:value={kind}>
						<option value="all">All</option>
						{#each CARD_KINDS as k (k)}
							<option value={k}>{KIND_LABEL[k]}</option>
						{/each}
					</select>
				</label>
				<label class="check"><input type="checkbox" bind:checked={dueNow} /> Due now</label>
				<label>
					Sort
					<select bind:value={sort}>
						<option value="added">Added</option>
						<option value="due">Due</option>
						<option value="state">State</option>
					</select>
				</label>
			</div>
			{#if basesFailed}
				<p class="hint">Readings could not be loaded, so search only covers the words themselves.</p>
			{/if}

			<p class="count" aria-live="polite">{filtered.length} of {rows.length} words</p>

			<div class="bar" role="group" aria-label="Selected words">
				<label class="check">
					<input
						type="checkbox"
						aria-label={`Select all ${filtered.length} shown`}
						checked={allChosen}
						onchange={toggleAll}
					/>
					All
				</label>
				<span>{chosen.length} selected</span>
				<label>
					Move to
					<select bind:value={target} disabled={chosen.length === 0 || controller.busy}>
						<option value="">Choose a deck</option>
						{#each moveTargets as d (d.id)}
							<option value={d.id}>{d.name}</option>
						{/each}
					</select>
				</label>
				<button type="button" disabled={chosen.length === 0 || target === '' || controller.busy} onclick={openMoveConfirm}>
					Move
				</button>
				<button
					type="button"
					class="danger"
					disabled={chosen.length === 0 || controller.busy}
					onclick={openConfirm}>Delete</button
				>
			</div>

			{#if confirmingMove && chosen.length > 0}
				<div
					class="confirm confirm-move"
					role="alertdialog"
					aria-label="Confirm move"
					tabindex="-1"
					onkeydown={confirmKey}
				>
					<p>
						Move {plural(chosen.length, 'word')} to {targetName}?
						{MOVE_NOTE}
					</p>
					<button type="button" onclick={move}>Move {plural(chosen.length, 'word')}</button>
					<button type="button" class="secondary" onclick={() => (confirmingMove = false)}>Cancel</button>
				</div>
			{/if}

			{#if confirming && chosen.length > 0}
				<div class="confirm" role="alertdialog" aria-label="Confirm delete" tabindex="-1" onkeydown={confirmKey}>
					<p>
						Delete {plural(chosen.length, 'word')} from every deck, with their other cards? You can
						undo this right after.
					</p>
					<button type="button" class="danger" onclick={remove}>Delete {plural(chosen.length, 'word')}</button>
					<button type="button" class="secondary" onclick={() => (confirming = false)}>Cancel</button>
				</div>
			{/if}

			{#if filtered.length === 0}
				<p class="hint">No words match.</p>
			{/if}
			<ul class="rows">
				{#each shown as row (row.entryId)}
					<li data-entry={row.entryId} class:picked={chosen.includes(row.entryId)}>
						<div class="line">
							<input
								class="pick"
								type="checkbox"
								aria-label={`Select ${row.written}`}
								checked={chosen.includes(row.entryId)}
								onchange={() => (selected = toggleNum(selected, row.entryId))}
							/>
							<a class="word" href={`/entry/${row.entryId}`}>{row.written}</a>
							<span class="reading">{readingBeside(row.written, bases.get(row.entryId)?.readings ?? [])}</span>
							<span class="state">{WORD_STATES.find((s) => s.state === row.state)?.label}</span>
							<span class="chips">
								{#each chips(row) as chip (chip.kind)}
									<span class="chip" class:off={chip.off}
										>{KIND_LABEL[chip.kind]}{chip.off ? ' off' : ''}</span
									>
								{/each}
							</span>
							<span class="due">{dueText(row)}</span>
							<button
								type="button"
								class="more"
								aria-expanded={expanded.includes(row.entryId)}
								aria-label={`Cards of ${row.written}`}
								onclick={() => (expanded = toggleNum(expanded, row.entryId))}
								>{expanded.includes(row.entryId) ? '▴' : '▾'}</button
							>
						</div>
						{#if expanded.includes(row.entryId)}
							<ul class="kinds">
								{#each OPT_IN_KINDS.filter((k) => enabled.has(k)) as k (k)}
									{@const ids = siblingIds(row, k)}
									<li>
										<span>{KIND_LABEL[k]} card{ids.length === 0 && !row.skipped.includes(k) ? ' (made when studied)' : ''}</span>
										{#if row.skipped.includes(k)}
											<button
												type="button"
												disabled={controller.busy}
												aria-label={`Turn ${KIND_LABEL[k]} back on`}
												onclick={() => void actions.unskip(row.entryId, k)}>Turn back on</button
											>
										{:else if ids.length > 0}
											<button
												type="button"
												disabled={controller.busy}
												aria-label={`Remove ${KIND_LABEL[k]}`}
												onclick={() => void actions.dropKind(ids)}>Remove</button
											>
										{:else if row.vocab !== null}
											<button
												type="button"
												disabled={controller.busy}
												aria-label={`Remove ${KIND_LABEL[k]}`}
												onclick={() => void actions.skip(row.entryId, k)}>Remove</button
											>
										{/if}
									</li>
								{/each}
								{#if OPT_IN_KINDS.every((k) => !enabled.has(k))}
									<li class="hint">Turn on Reverse or Cloze in the deck settings to manage them here.</li>
								{/if}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
			{#if remaining > 0}
				<button type="button" class="moreRows" onclick={() => (pages += 1)}
					>Show {Math.min(PAGE_SIZE, remaining)} more</button
				>
			{/if}
		{/if}
		{#if controller.error}
			<p class="error" role="alert">{controller.error}</p>
		{/if}
	{/if}

	<div class="toast-region" role="status" aria-live="polite">
		{#if controller.undo}
			<div
				class="toast"
				role="presentation"
				onmouseenter={() => actions.pauseTimer()}
				onmouseleave={() => actions.resumeTimer()}
				onfocusin={() => actions.pauseTimer()}
				onfocusout={() => actions.resumeTimer()}
			>
				<span>{controller.undo.text}</span>
				<button type="button" disabled={controller.busy} onclick={() => void actions.undo()}>Undo</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.numbers p {
		margin: 0.25rem 0;
	}

	.actions,
	.bar,
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin: 0.5rem 0;
	}

	.filters label,
	.bar label {
		display: grid;
		gap: 0.15rem;
		font-size: 0.85rem;
	}

	label.check {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
	}

	button,
	.actions a {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
	}

	.primary {
		padding: 0 1rem;
		border: 1px solid #0b6bcb;
		border-radius: 999px;
		background: #0b6bcb;
		color: #fff;
		font-weight: 600;
	}

	.danger {
		color: #c62828;
	}

	.source {
		margin: 0.1rem 0;
		font-size: 0.85rem;
		opacity: 0.8;
	}

	.count {
		margin: 0.25rem 0;
		font-size: 0.85rem;
		opacity: 0.8;
	}

	.rows,
	.kinds {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
	}

	.rows > li {
		padding: 0.25rem 0.5rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
	}

	.rows > li.picked {
		background: color-mix(in srgb, #0b6bcb 12%, transparent);
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
	}

	.pick {
		width: 1.25rem;
		height: 1.25rem;
	}

	.word {
		font-size: 1.1rem;
		font-weight: 600;
	}

	.reading,
	.state,
	.due {
		font-size: 0.85rem;
		opacity: 0.85;
	}

	.chip {
		font-size: 0.75rem;
		padding: 0.05rem 0.45rem;
		margin-right: 0.25rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 999px;
	}

	.chip.off {
		opacity: 0.6;
		text-decoration: line-through;
	}

	.more {
		margin-left: auto;
		min-width: 44px;
		justify-content: center;
		border: 0;
		background: transparent;
	}

	.kinds li {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 0.15rem 0 0.15rem 2rem;
		font-size: 0.9rem;
	}

	.confirm {
		margin: 0.5rem 0;
		padding: 0.75rem;
		border: 1px solid #c62828;
		border-radius: 0.5rem;
	}

	.error {
		color: #c62828;
		font-weight: 600;
	}

	.toast-region {
		position: fixed;
		inset: auto 1rem 1rem 1rem;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}

	.toast {
		pointer-events: auto;
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		background: #222;
		color: #fff;
	}

	.hint {
		opacity: 0.8;
	}
</style>
