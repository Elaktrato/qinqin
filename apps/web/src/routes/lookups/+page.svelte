<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { onDestroy, tick } from 'svelte';
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import {
		PAGE_SIZE,
		addResultText,
		dayLabel,
		deckOptions,
		historyCountText,
		historyRows,
		stateLabel,
		type HistoryFilter
	} from '$lib/lookups/historyView';
	import { promptItems } from '$lib/lookups/lookups';
	import { addEntries, loadPage, type PageData } from '$lib/lookups/pageData';
	import { clearHistory, removeFromHistory, saveLookupCfg } from '$lib/lookups/store';
	import { GENERAL_DECK_ID } from '$lib/study/store';
	import { currentStudyDay } from '$lib/time/zone';
	import { workspaces } from '$lib/workspaces';
	import { glossLang, studyLang, wordReadingLang, readingLang } from '$lib/i18n/lang';
	import { Button, Section, Select } from '$lib/ui';

	// The lookup history of the current workspace (#72): what the learner
	// looked up, add to a deck, remove, clear, and the recording switch. The
	// rules live in $lib/lookups; nothing here is kept in browser storage.

	const ws = $derived($workspaces.current);
	const wsId = $derived(ws?.id ?? null);
	const wsName = $derived(ws ? ws.name || ws.language : '');

	let data = $state<PageData | null>(null);
	let loadError = $state('');
	let filter = $state<HistoryFilter>('all');
	let shown = $state(PAGE_SIZE);
	let selected = $state<number[]>([]);
	let deckId = $state(GENERAL_DECK_ID);
	let busy = $state(false);
	let status = $state('');
	let actionError = $state('');
	let confirming = $state(false);
	let record = $state(true);
	let offerClear = $state(false);
	let mounted = true;
	let seq = 0;

	async function load(id: number): Promise<void> {
		const mine = ++seq;
		loadError = '';
		try {
			const next = await loadPage(id);
			if (mine !== seq) return;
			data = next;
			record = next.record;
		} catch {
			if (mine !== seq) return;
			loadError = t('lookups.loadFailed');
		}
	}

	$effect(() => {
		const id = wsId;
		data = null;
		selected = [];
		shown = PAGE_SIZE;
		confirming = false;
		status = '';
		filterAnnouncement = '';
		if (id !== null) void load(id);
	});

	onDestroy(() => (mounted = false));

	const day = currentStudyDay();
	const today = day.today();
	const dayOf = (iso: string) => day.dayOf(Date.parse(iso));
	const rows = $derived(data ? historyRows(data.history, data.bases, data.books, data.stateOf, dayOf, filter) : []);
	const visible = $derived(rows.slice(0, shown));
	const decks = $derived(deckOptions(data?.decks ?? []));
	const deck = $derived(decks.find((d) => d.id === deckId) ?? decks[0]);
	const prompt = $derived(
		data ? promptItems(data.history, data.stateOf).filter((i) => data?.bases.has(i.entryId)) : []
	);
	const written = (id: number) => data?.bases.get(id)?.written ?? '';

	// What a screen reader hears after the filter changes (the visible count
	// above the list also follows Add and Remove, silently).
	let filterAnnouncement = $state('');

	async function announceFilter(): Promise<void> {
		await tick();
		filterAnnouncement = data ? historyCountText(rows.length, data.history.items.length, filter) : '';
	}

	function toggle(id: number, on: boolean): void {
		selected = on ? [...selected, id] : selected.filter((x) => x !== id);
	}

	async function act(work: () => Promise<void>): Promise<void> {
		if (busy || wsId === null) return;
		busy = true;
		status = '';
		actionError = '';
		try {
			await work();
		} catch (err) {
			actionError = errorText(err, t('lookups.actionFailed'));
		} finally {
			busy = false;
		}
	}

	function add(ids: number[]): Promise<void> {
		return act(async () => {
			const id = wsId as number;
			const target = deck;
			const result = await addEntries(id, ids, target);
			status = addResultText(result, target.name);
			selected = [];
			await load(id);
		});
	}

	function remove(ids: number[]): Promise<void> {
		return act(async () => {
			const history = await removeFromHistory(wsId as number, ids);
			if (data) data = { ...data, history };
			selected = selected.filter((x) => !ids.includes(x));
			status = t('lookups.removed', { count: ids.length });
		});
	}

	function clearAll(): Promise<void> {
		return act(async () => {
			const id = wsId as number;
			confirming = false;
			offerClear = false;
			try {
				// The store checks the row again 30 s later (another device's stale
				// write-back); reload when it had to clear again and the page is open.
				const out = await clearHistory(id, new Date(), {
					onRepaired: (w) => {
						if (mounted && w === wsId) void load(w);
					}
				});
				if (data) data = { ...data, history: out.history };
				status = t('lookups.cleared');
			} catch (err) {
				// The row may be cleared even when the old search records were not.
				await load(id);
				throw err;
			} finally {
				selected = [];
			}
		});
	}

	function setRecord(on: boolean): Promise<void> {
		return act(async () => {
			await saveLookupCfg(on);
			record = on;
			offerClear = !on && (data?.history.items.length ?? 0) > 0;
		});
	}
</script>

<svelte:head>
	<title>{pageTitle(t('lookups.title'))}</title>
</svelte:head>

<div class="page-body lookups-page">
	<h1>{t('lookups.title')}</h1>

	<div class="switch-row">
		<Button
			role="switch"
			aria-checked={record}
			aria-describedby="record-hint"
			class="switch"
			disabled={busy || data === null}
			onclick={() => setRecord(!record)}>{t('lookups.record')}</Button
		>
		<p id="record-hint" class="hint">{t('lookups.recordHint')}</p>
	</div>
	{#if offerClear}
		<p class="offer">
			{t('lookups.recordingOff')}
			<Button tone="danger" onclick={() => ((confirming = true), (offerClear = false))}
				>{t('lookups.clearToo')}</Button
			>
		</p>
	{/if}

	{#if wsId === null}
		<p class="hint">{t('lookups.noWorkspace')}</p>
	{:else if loadError}
		<p role="alert">{loadError} <Button onclick={() => wsId !== null && load(wsId)}>{t('common.action.retry')}</Button></p>
	{:else if data === null}
		<p role="status">{t('common.loading')}</p>
	{:else}
		{#if prompt.length > 0}
			<Section title={t('lookups.prompt.title')}>
				<p class="words">
					{#each prompt as p, i (p.entryId)}{i > 0 ? '、' : ''}<a href={`/entry/${p.entryId}`}>{written(p.entryId)}</a
						> <span class="count">×{p.count}</span>{/each}
				</p>
				<Button variant="primary" disabled={busy} onclick={() => add(prompt.map((p) => p.entryId))}
					>{t('lookups.prompt.add', { count: prompt.length, deck: deck.name })}</Button
				>
			</Section>
		{/if}

		<div class="toolbar" role="group" aria-label={t('lookups.toolbar')}>
			<div class="deck-pick">
				<Select label={t('lookups.deck')} bind:value={deckId} disabled={busy} options={decks.map((d) => ({ value: d.id, label: d.name }))} />
			</div>
			<Button disabled={busy || selected.length === 0} onclick={() => add([...selected])}
				>{t('lookups.addSelected', { count: selected.length })}</Button
			>
			<Button disabled={busy || selected.length === 0} onclick={() => remove([...selected])}
				>{t('lookups.removeSelected', { count: selected.length })}</Button
			>
			<fieldset class="filter" onchange={announceFilter}>
				<legend class="visually-hidden">{t('lookups.filter.show')}</legend>
				<label><input type="radio" name="filter" value="all" bind:group={filter} /> {t('lookups.filter.all')}</label>
				<label><input type="radio" name="filter" value="nocard" bind:group={filter} /> {t('lookups.filter.noCard')}</label>
			</fieldset>
			<Button
				tone="danger"
				disabled={busy || data.history.items.length === 0}
				onclick={() => (confirming = true)}>{t('lookups.clear')}</Button
			>
		</div>

		{#if confirming}
			<div class="confirm" role="group" aria-label={t('lookups.clearLabel')}>
				<p>{t('lookups.clearConfirm', { workspace: wsName })}</p>
				<Button variant="primary" tone="danger" disabled={busy} onclick={clearAll}>{t('common.action.delete')}</Button>
				<Button disabled={busy} onclick={() => (confirming = false)}>{t('notes.keep')}</Button>
			</div>
		{/if}

		<p role="status" class="status">{status}</p>
		{#if actionError}<p role="alert">{actionError}</p>{/if}

		<p class="history-count">{historyCountText(rows.length, data.history.items.length, filter)}</p>
		<!-- Read out only when the filter changes: Add and Remove have their own status. -->
		<p class="filter-live visually-hidden" aria-live="polite">{filterAnnouncement}</p>

		{#if data.history.items.length === 0}
			<p class="hint">{t('lookups.empty')}</p>
		{:else if rows.length === 0}
			<p class="hint">{t('lookups.allCarded')}</p>
		{:else}
			<ul class="list" aria-label={t('lookups.list')}>
				{#each visible as row (row.entryId)}
					<li class="row">
						{#if row.missing}
							<span class="word missing">{t('lookups.missing')}</span>
						{:else}
							<input
								type="checkbox"
								aria-label={t('lookups.select', { word: row.written ?? '' })}
								checked={selected.includes(row.entryId)}
								onchange={(e) => toggle(row.entryId, e.currentTarget.checked)}
							/>
							<a class="word" href={`/entry/${row.entryId}`} lang={studyLang(ws?.language)}>{row.written}</a>
							{#if row.reading}<span class="reading" lang={wordReadingLang(ws?.language)}>{row.reading}</span>{/if}
						{/if}
						<span class="count">×{row.count}</span>
						<span class="when">{t('lookups.last', { day: dayLabel(row.lastDay, today) })}</span>
						{#if row.where}<span class="where">{row.where}</span>{/if}
						{#if !row.missing}<span class="chip" data-state={row.state}>{stateLabel(row.state)}</span>{/if}
						<span class="actions">
							{#if !row.missing}
								<Button disabled={busy} aria-label={t('lookups.addWord', { word: row.written ?? '' })} onclick={() => add([row.entryId])}
									>{t('lookups.add')}</Button
								>
							{/if}
							<Button
								disabled={busy}
								aria-label={t('lookups.removeWord', { word: row.written ?? t('lookups.thisWord') })}
								onclick={() => remove([row.entryId])}>{t('common.action.remove')}</Button
							>
						</span>
					</li>
				{/each}
			</ul>
			{#if rows.length > shown}
				<Button onclick={() => (shown += PAGE_SIZE)}>{t('lookups.showMore')}</Button>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.hint {
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: end;
		margin-block: var(--space-4) var(--space-2);
	}

	.deck-pick {
		flex: 0 1 14rem;
	}

	.filter {
		display: flex;
		gap: var(--space-2);
		border: 0;
		margin: 0;
		padding: 0;
		align-items: center;
		min-height: var(--hit);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		align-items: center;
		padding-block: var(--space-2);
		border-bottom: 1px solid var(--hair);
		overflow-wrap: anywhere;
	}

	.word {
		font-size: var(--font-size-l);
		font-family: var(--font-hanzi);
	}

	.missing {
		font-size: var(--font-size-label);
		font-style: italic;
	}

	.history-count {
		margin-block: var(--space-2);
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.reading,
	.when,
	.where,
	.count {
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.actions {
		margin-inline-start: auto;
		display: flex;
		gap: var(--space-1);
	}
</style>
