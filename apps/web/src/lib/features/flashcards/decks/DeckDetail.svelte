<script lang="ts">
	import { withStudy } from '$lib/study/data';
	import { readingBeside } from '$lib/entry/displayForm';
	import { t, type MessageKey } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { onDestroy, tick, untrack } from 'svelte';
	import { loadEntryBases } from '$lib/api/entryBases';
	import type { EntryBase } from '$lib/api/types';
	import type { Deck } from '$lib/study/types';
	import { WORD_STATES, type WordState } from '$lib/stats/wordStates';
	import { createCardActions, type CardActionsState } from '$lib/study/cardActions';
	import { enabledKinds } from '$lib/study/deckSettings';
	import { saveConfig } from '$lib/study/session';
	import { here } from '$lib/routing/here';
	import {
		deleteCards,
		dropSiblingCards,
		moveCards,
		restoreCards,
		skipKind,
		unskipKind
	} from '$lib/study/commands/cards';
	import { CARD_KINDS, OPT_IN_KINDS, type StudyCardKind, GENERAL_DECK_ID } from '$lib/study/types';
	import { glossLang, studyLang, wordReadingLang, readingLang } from '$lib/i18n/lang';
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
	import { Button, Chip, Field, Select } from '$lib/ui';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	let { deckId }: { deckId: string } = $props();

	const store = createDecksData(session);
	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	$effect(() => {
		void store.load(workspaceId);
	});
	// A new learner day (or zone) changes what is due and on vacation.
	$effect(() => onContextStale(session.zone, () => void store.load(workspaceId)));

	const KIND_KEYS: Record<StudyCardKind, MessageKey> = {
		vocab: 'study.cardType.vocab',
		sentence: 'study.cardType.sentence',
		writing: 'study.cardType.writing',
		tone: 'study.cardType.tone',
		reverse: 'study.cardType.reverse',
		cloze: 'study.cardType.cloze'
	};

	const data = $derived(store.data);
	const deck = $derived(
		data === null
			? null
			: deckId === GENERAL_DECK_ID
				? ({ id: GENERAL_DECK_ID, name: t('flashcards.deck.general') } as Deck)
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
			merge(await loadEntryBases(session.caches.entryBases, first));
			if (ids.length > first.length) merge(await loadEntryBases(session.caches.entryBases, ids, { priority: first }));
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
					limitsLeftToday(deckId, data, sessionKinds(session.setups.of(data.workspaceId).setup, [deckId], data.deckSettings, session.workspaces.current?.language ?? ''))
				)
	);

	const numbers = $derived(
		data === null || deck === null
			? null
			: deckNumbers({
					...data,
					w: data.weights,
					deckId,
					kinds: sessionKinds(session.setups.of(data.workspaceId).setup, [deckId], data.deckSettings, session.workspaces.current?.language ?? '')
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
		deleteCards: withStudy(session.study, deleteCards),
		moveCards: withStudy(session.study, moveCards),
		restoreCards: withStudy(session.study, restoreCards),
		dropSiblingCards: withStudy(session.study, dropSiblingCards),
		skipKind: withStudy(session.study, skipKind),
		unskipKind: withStudy(session.study, unskipKind),
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
			: [{ id: GENERAL_DECK_ID, name: t('flashcards.deck.general') }, ...data.decks].filter((d) => d.id !== deckId)
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

	/** The workspace of the rows on screen, captured when the user acts (#174). */
	const shownWorkspace = (): number | null => data?.workspaceId ?? null;

	async function remove(): Promise<void> {
		const ws = shownWorkspace();
		if (ws === null) return;
		const entries = [...chosen];
		const index = Math.min(...entries.map((id) => filtered.findIndex((r) => r.entryId === id)).filter((i) => i >= 0));
		confirming = false;
		await actions.remove(ws, idsOf(entries));
		selected = selected.filter((id) => !entries.includes(id));
		await focusRow(Number.isFinite(index) ? index : 0);
	}

	function act(write: (ws: number) => Promise<void>): Promise<void> {
		const ws = shownWorkspace();
		return ws === null ? Promise.resolve() : write(ws);
	}

	const targetName = $derived(moveTargets.find((d) => d.id === target)?.name ?? target);

	function openMoveConfirm(): void {
		if (target === '' || chosen.length === 0) return;
		confirming = false;
		confirmingMove = true;
		void tick().then(() => root?.querySelector<HTMLElement>('.confirm-move .secondary')?.focus());
	}

	async function move(): Promise<void> {
		const ws = shownWorkspace();
		if (target === '' || chosen.length === 0 || ws === null) return;
		const entries = [...chosen];
		const index = Math.min(...entries.map((id) => filtered.findIndex((r) => r.entryId === id)).filter((i) => i >= 0));
		confirmingMove = false;
		await actions.move(ws, idsOf(entries), target, targetName);
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
		const setup = session.setups.of(data.workspaceId).setup;
		saveConfig(
			deckSessionConfig(setup, deckId, sessionKinds(setup, [deckId], data.deckSettings, session.workspaces.current?.language ?? ''), here())
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

	const kindLabel = (k: StudyCardKind): string => t(KIND_KEYS[k]);

	function dueText(row: DeckRow): string {
		if (row.nextDue === null || data === null) return '—';
		return data.ctx.day.dayOf(Date.parse(row.nextDue));
	}
</script>

<div bind:this={root}>
	{#if store.status === 'loading'}
		<p role="status">{t('flashcards.deck.loading')}</p>
	{:else if store.status === 'no-workspace'}
		<p role="status">{t('flashcards.deck.noWorkspace')}</p>
	{:else if store.status === 'error'}
		<p role="alert">{store.error}</p>
		<Button onclick={() => void store.load(workspaceId, true)}>{t('flashcards.deck.tryAgain')}</Button>
	{:else if deck === null || numbers === null}
		<p role="status">{t('flashcards.deck.notFound')}</p>
		<a href={flashcardsHref({ view: 'list' })}>{t('flashcards.deck.backToDecks')}</a>
	{:else}
		<p class="back"><a href={flashcardsHref({ view: 'list' })}>{t('flashcards.deck.back')}</a></p>
		<h1 tabindex="-1">{deck.name}</h1>
		{#if deck.source !== undefined}
			<p class="source">
				{t('flashcards.deck.copiedFrom', { source: copiedFrom(deck.source) })}
			</p>
		{/if}
		<section class="numbers" aria-label={t('flashcards.deck.numbersLabel', { name: deck.name })}>
			<p>
				{#if data?.ctx.vacationToday}{t('flashcards.deck.numbersVacation', {
						words: t('flashcards.deck.words', { count: numbers.words }),
						cards: t('flashcards.deck.cards', { count: numbers.cards }),
						studied: numbers.studied,
						mastered: numbers.mastered
					})}{:else}{t('flashcards.deck.numbers', {
						words: t('flashcards.deck.words', { count: numbers.words }),
						cards: t('flashcards.deck.cards', { count: numbers.cards }),
						due: numbers.due,
						fresh: numbers.fresh,
						studied: numbers.studied,
						mastered: numbers.mastered
					})}{/if}
			</p>
			{#if leftText !== null && !data?.ctx.vacationToday}
				<p class="left">{leftText}</p>
			{/if}
			<div class="actions">
				<Button variant="primary" onclick={study}>{t('flashcards.deck.study')}</Button>
				<Button href={flashcardsHref({ view: 'settings', deckId })}>{t('flashcards.deck.settings')}</Button>
			</div>
		</section>

		{#if rows.length === 0}
			<p class="hint">{t('flashcards.deck.empty')}</p>
		{:else}
			<div class="filters">
				<div class="search">
					<Field
						label={t('flashcards.deck.search')}
						type="search"
						value={text}
						oninput={(e) => onSearch(e.currentTarget.value)}
						placeholder={t('flashcards.deck.searchPlaceholder')}
					/>
				</div>
				<Select
					label={t('flashcards.deck.state')}
					bind:value={stateFilter}
					options={[
						{ value: 'all', label: t('flashcards.deck.all') },
						...WORD_STATES.map((s) => ({ value: s.state, label: s.label }))
					]}
				/>
				<Select
					label={t('flashcards.deck.kind')}
					bind:value={kind}
					options={[
						{ value: 'all', label: t('flashcards.deck.all') },
						...CARD_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))
					]}
				/>
				<label class="check"><input type="checkbox" bind:checked={dueNow} /> {t('flashcards.deck.dueNow')}</label>
				<Select
					label={t('flashcards.deck.sort')}
					bind:value={sort}
					options={[
						{ value: 'added', label: t('flashcards.deck.sortAdded') },
						{ value: 'due', label: t('flashcards.deck.sortDue') },
						{ value: 'state', label: t('flashcards.deck.sortState') }
					]}
				/>
			</div>
			{#if basesFailed}
				<p class="hint">{t('flashcards.deck.basesFailed')}</p>
			{/if}

			<p class="count" aria-live="polite">{t('flashcards.deck.count', { shown: filtered.length, total: rows.length })}</p>

			<div class="bar" role="group" aria-label={t('flashcards.deck.selectedWords')}>
				<label class="check">
					<input
						type="checkbox"
						aria-label={t('flashcards.deck.selectAll', { count: filtered.length })}
						checked={allChosen}
						onchange={toggleAll}
					/>
					{t('flashcards.deck.all')}
				</label>
				<span>{t('flashcards.deck.selected', { count: chosen.length })}</span>
				<Select
					label={t('flashcards.deck.moveTo')}
					bind:value={target}
					disabled={chosen.length === 0 || controller.busy}
					options={[
						{ value: '', label: t('flashcards.deck.chooseDeck') },
						...moveTargets.map((d) => ({ value: d.id, label: d.name }))
					]}
				/>
				<Button disabled={chosen.length === 0 || target === '' || controller.busy} onclick={openMoveConfirm}>
					{t('flashcards.deck.move')}
				</Button>
				<Button
					tone="danger"
					disabled={chosen.length === 0 || controller.busy}
					onclick={openConfirm}>{t('flashcards.deck.delete')}</Button
				>
			</div>

			{#if confirmingMove && chosen.length > 0}
				<div
					class="confirm confirm-move"
					role="alertdialog"
					aria-label={t('flashcards.deck.confirmMove')}
					tabindex="-1"
					onkeydown={confirmKey}
				>
					<p>
						{t('flashcards.deck.moveQuestion', { count: chosen.length, deck: targetName })}
						{t('flashcards.deck.moveNote')}
					</p>
					<Button variant="primary" onclick={move}>{t('flashcards.deck.moveWords', { count: chosen.length })}</Button>
					<Button onclick={() => (confirmingMove = false)}>{t('common.action.cancel')}</Button>
				</div>
			{/if}

			{#if confirming && chosen.length > 0}
				<div class="confirm" role="alertdialog" aria-label={t('flashcards.deck.confirmDelete')} tabindex="-1" onkeydown={confirmKey}>
					<p>
						{t('flashcards.deck.deleteQuestion', { count: chosen.length })}
					</p>
					<Button variant="primary" tone="danger" onclick={remove}>{t('flashcards.deck.deleteWords', { count: chosen.length })}</Button>
					<Button onclick={() => (confirming = false)}>{t('common.action.cancel')}</Button>
				</div>
			{/if}

			{#if filtered.length === 0}
				<p class="hint">{t('flashcards.deck.noMatch')}</p>
			{/if}
			<ul class="rows">
				{#each shown as row (row.entryId)}
					<li data-entry={row.entryId} class:picked={chosen.includes(row.entryId)}>
						<div class="line">
							<input
								class="pick"
								type="checkbox"
								aria-label={t('flashcards.deck.select', { word: row.written })}
								checked={chosen.includes(row.entryId)}
								onchange={() => (selected = toggleNum(selected, row.entryId))}
							/>
							<a class="word" href={`/entry/${row.entryId}`} lang={studyLang(session.workspaces.current?.language)}>{row.written}</a>
							<span class="reading" lang={wordReadingLang(session.workspaces.current?.language)}
								>{readingBeside(row.written, bases.get(row.entryId)?.readings ?? [])}</span
							>
							<span class="state">{WORD_STATES.find((s) => s.state === row.state)?.label}</span>
							<span class="chips">
								{#each chips(row) as chip (chip.kind)}
									<span class="chip" class:off={chip.off}
										><Chip
											>{chip.off
												? t('flashcards.deck.kindOff', { kind: kindLabel(chip.kind) })
												: kindLabel(chip.kind)}</Chip
										></span
									>
								{/each}
							</span>
							<span class="due">{dueText(row)}</span>
							<Button
								class="more"
								aria-expanded={expanded.includes(row.entryId)}
								aria-label={t('flashcards.deck.cardsOf', { word: row.written })}
								onclick={() => (expanded = toggleNum(expanded, row.entryId))}
								>{expanded.includes(row.entryId) ? '▴' : '▾'}</Button
							>
						</div>
						{#if expanded.includes(row.entryId)}
							<ul class="kinds">
								{#each OPT_IN_KINDS.filter((k) => enabled.has(k)) as k (k)}
									{@const ids = siblingIds(row, k)}
									<li>
										<span
											>{ids.length === 0 && !row.skipped.includes(k)
												? t('flashcards.deck.kindCardLater', { kind: kindLabel(k) })
												: t('flashcards.deck.kindCard', { kind: kindLabel(k) })}</span
										>
										{#if row.skipped.includes(k)}
											<Button
												disabled={controller.busy}
												aria-label={t('flashcards.deck.turnBackOnNamed', { kind: kindLabel(k) })}
												onclick={() => void act((ws) => actions.unskip(ws, row.entryId, k))}>{t('flashcards.deck.turnBackOn')}</Button
											>
										{:else if ids.length > 0}
											<Button
												disabled={controller.busy}
												aria-label={t('flashcards.deck.removeNamed', { kind: kindLabel(k) })}
												onclick={() => void act((ws) => actions.dropKind(ws, ids))}>{t('flashcards.deck.remove')}</Button
											>
										{:else if row.vocab !== null}
											<Button
												disabled={controller.busy}
												aria-label={t('flashcards.deck.removeNamed', { kind: kindLabel(k) })}
												onclick={() => void act((ws) => actions.skip(ws, row.entryId, k))}>{t('flashcards.deck.remove')}</Button
											>
										{/if}
									</li>
								{/each}
								{#if OPT_IN_KINDS.every((k) => !enabled.has(k))}
									<li class="hint">{t('flashcards.deck.optInHint')}</li>
								{/if}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
			{#if remaining > 0}
				<Button onclick={() => (pages += 1)}
					>{t('flashcards.deck.showMore', { count: Math.min(PAGE_SIZE, remaining) })}</Button
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
				<Button disabled={controller.busy} onclick={() => void actions.undo()}>{t('flashcards.deck.undo')}</Button>
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

	.filters :global(.field),
	.bar :global(.field) {
		min-width: 8rem;
		flex: 0 1 12rem;
	}

	.filters .search {
		flex: 1 1 14rem;
	}

	label.check {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
	}

	.source {
		margin: 0.1rem 0;
		font-size: 0.85rem;
		color: var(--readable-muted);
	}

	.count {
		margin: 0.25rem 0;
		font-size: 0.85rem;
		color: var(--readable-muted);
	}

	.rows,
	.kinds {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
	}

	.rows > li {
		padding-block: var(--space-2);
		border-bottom: 1px solid var(--hair);
	}

	.rows > li.picked {
		background: var(--primary-wash);
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
		font-size: var(--font-size-xl);
		font-family: var(--font-hanzi);
	}

	.reading,
	.state,
	.due {
		font-size: 0.85rem;
		color: var(--readable-muted);
	}

	.chip {
		display: inline-flex;
		margin-right: var(--space-1);
	}

	.chip.off :global(.chip) {
		color: var(--readable-muted);
		text-decoration: line-through;
	}

	.kinds li {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 0.15rem 0 0.15rem 2rem;
		font-size: 0.9rem;
	}

	.confirm {
		margin-block: var(--space-2);
		padding-block: var(--space-3);
		border-top: 1px solid var(--bad);
	}

	.error {
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.toast-region {
		position: fixed;
		/* Above the phone bottom bar (#188) and the safe area. */
		inset: auto 1rem calc(1rem + max(var(--bottom-bar-space, 0px), env(safe-area-inset-bottom, 0px))) 1rem;
		z-index: var(--layer-float);
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
		border: 1px solid var(--hair);
		border-radius: 0.5rem;
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-float);
	}

	.hint {
		color: var(--readable-muted);
	}
</style>
