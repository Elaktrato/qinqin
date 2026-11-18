<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import { glossLang, studyLang, wordReadingLang, readingLang } from '$lib/i18n/lang';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { search } from '$lib/api/search';
	import type { SearchHit } from '$lib/api/types';
	import { recordLookup } from '$lib/lookups/sink';
	import { currentLanguage, workspaces, workspacesLoaded } from '$lib/workspaces';
	import { getSchemes } from '$lib/api/schemes';
	import type { Scheme } from '$lib/api/types';
	import {
		KINDS,
		clearFilters,
		filtersFromParams,
		hasFilters,
		reconcileFilters,
		schemesForLanguage,
		searchHref,
		selectedFromParams,
		setKind,
		setLevel,
		setScheme,
		type SearchFilters
	} from '$lib/searchFilters';
	import { onMount } from 'svelte';
	import { listLanguages } from '$lib/api/languages';
	import { dictionaryHint } from '$lib/coverage';
	import { hiddenDictionaries } from '$lib/dictionaryVisibility';
	import { languageLabel, usesHan } from '$lib/languages';
	import { user } from '$lib/auth';
	import Field from '$lib/ui/Field.svelte';
	import Button from '$lib/ui/Button.svelte';
	import ResultRow from './ResultRow.svelte';
	import EntryView from '$lib/entry/EntryView.svelte';

	// The server's default result cap (lexicon.defaultSearchLimit).
	const RESULT_CAP = 50;

	let query = $state('');
	let hits = $state<SearchHit[]>([]);
	let loading = $state(false);
	let error = $state('');
	let searched = $state(false);
	// The query whose results are shown, so the retry button and the
	// empty state refer to it even after the input changes.
	let activeQuery = $state('');

	const lang = $derived($currentLanguage);
	const hidden = $derived(hiddenDictionaries($workspaces.current));
	const urlQuery = $derived(page.url.searchParams.get('q') ?? '');
	const selected = $derived(selectedFromParams(page.url.searchParams));
	const selectedHit = $derived(selected === null ? null : (hits.find((h) => h.id === selected) ?? null));
	const preview = $derived(selectedHit ?? hits[0] ?? null);

	// Guards against a slow earlier request overwriting a newer result.
	let requestSeq = 0;

	let allSchemes = $state<Scheme[]>([]);
	let schemesFailed = $state(false);
	const filters = $derived(filtersFromParams(page.url.searchParams));
	const schemes = $derived(schemesForLanguage(allSchemes, lang));
	const activeScheme = $derived(schemes.find((s) => s.packId === filters.scheme));
	let schemesLoaded = $state(false);

	// Languages with installed dictionary data; null until loaded.
	let installedCodes = $state<Set<string> | null>(null);
	const noDictionary = $derived(
		lang !== null && installedCodes !== null && !installedCodes.has(lang.toLowerCase())
	);

	onMount(() => {
		listLanguages().then(
			(list) => (installedCodes = new Set(list.filter((l) => l.installed).map((l) => l.code.toLowerCase()))),
			() => {}
		);
		getSchemes().then(
			(list) => {
				allSchemes = list;
				schemesLoaded = true;
			},
			() => (schemesFailed = true)
		);
	});

	// Chips act on the committed search (the URL query), not on text still
	// being typed: a chip never silently submits a half-typed query.
	function applyFilters(next: SearchFilters): void {
		goto(searchHref(urlQuery.trim(), next, selected), { keepFocus: true, noScroll: true }).catch(() => {});
	}

	// After a workspace/language switch, a scheme or level of another
	// language must not stay in the URL as a hidden filter.
	$effect(() => {
		if (!schemesLoaded || lang === null) return;
		const next = reconcileFilters(filters, schemes);
		if (next !== filters) {
			goto(searchHref(urlQuery.trim(), next, selected), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			}).catch(() => {});
		}
	});

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	// Opening a result is the look-up (#72): it goes to the lookup history
	// of the current workspace (a click, Enter, Ctrl/Cmd-click or a middle
	// click; "open in new tab" from the context menu is not seen). Typed
	// queries are never recorded.
	function openedHit(entryId: number): void {
		recordLookup(get(workspaces).current?.id, { entryId, source: 'search' });
	}

	/** Choosing a result: desktop replaces the entry in place; a phone pushes, so Back returns to the list. */
	function choose(event: MouseEvent, entryId: number): void {
		if (event.metaKey || event.ctrlKey || event.shiftKey) {
			openedHit(entryId);
			return;
		}
		event.preventDefault();
		openedHit(entryId);
		const wide =
			typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 720px)').matches;
		void goto(searchHref(activeQuery, filters, entryId), {
			replaceState: wide,
			keepFocus: wide,
			noScroll: true
		});
	}

	// What a screen reader hears once a search settles; empty while it runs
	// or when there is nothing to say (the visible hint covers those).
	const announcement = $derived.by(() => {
		if (loading || error || !searched) return '';
		if (hits.length === 0) return t('search.noResults', { query: activeQuery });
		return t('search.resultsAnnounce', { count: hits.length, query: activeQuery });
	});

	function sourceLabel(source: string): string {
		return source === 'written' ? t('search.matchedWritten') : source;
	}

	async function runSearch(q: string, language: string, f: SearchFilters): Promise<void> {
		const seq = ++requestSeq;
		activeQuery = q;
		searched = true;
		loading = true;
		error = '';
		try {
			const list = await search(language, q, {
				kind: f.kind || undefined,
				scheme: f.scheme || undefined,
				level: f.level || undefined
			});
			if (seq !== requestSeq) return;
			hits = list;
		} catch (err) {
			if (seq !== requestSeq) return;
			hits = [];
			error = message(err, t('search.failed'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		const q = query.trim();
		// Show the query that is searched, not the untrimmed text typed.
		query = q;
		const href = searchHref(q, filters);
		// The same search again does not change the URL, so the effect below
		// would not run: treat it as a refresh instead of a silent no-op.
		if (q && lang && q === urlQuery.trim() && href === searchHref(urlQuery.trim(), filters)) {
			void runSearch(q, lang, filters);
			return;
		}
		// The URL effect below runs the query and records the lookup, so
		// submitting only navigates. A navigation superseded by a newer one
		// may reject; that is not an error for the user.
		goto(href).catch(() => {});
	}

	function retry(): void {
		if (lang && activeQuery) void runSearch(activeQuery, lang, filters);
	}

	// The URL is the source of truth for the query: the input mirrors it
	// so reloads and shared links show the same search.
	$effect(() => {
		query = urlQuery;
	});

	// Search whenever the URL query or the workspace language changes.
	$effect(() => {
		const q = urlQuery.trim();
		const language = lang;
		const f = filtersFromParams(page.url.searchParams);
		if (!q || !language) {
			requestSeq++;
			hits = [];
			activeQuery = q;
			loading = false;
			error = '';
			searched = false;
			return;
		}
		void runSearch(q, language, f);
	});
</script>

<svelte:head>
	<title>{pageTitle(selectedHit?.written ?? '', t('search.title'))}</title>
</svelte:head>

<div class="page-body search-page">
	<h1>{t('search.title')}</h1>

	<div class="split" class:has-selection={selected !== null}>
		<div class="list-pane">

	<form class="search" role="search" onsubmit={submit}>
		<Field
			label={t('search.input.label')}
			hideLabel
			name="q"
			type="search"
			bind:value={query}
			placeholder={lang !== null
				? t('search.input.placeholder')
				: $workspacesLoaded
					? t('search.input.selectWorkspace')
					: t('search.input.loadingWorkspaces')}
			disabled={lang === null}
		/>
		<Button type="submit" variant="primary" disabled={lang === null}>{t('search.submit')}</Button>
		{#if lang !== null && usesHan(lang)}
			<Button variant="secondary" href="/search/parts" icon="parts">{t('search.byParts')}</Button>
		{/if}
	</form>

	<p class="parts-link"><a href="/lookups">{t('search.lookupsLink')}</a></p>

	{#if lang !== null}
		<div class="filters" role="group" aria-label={t('search.filters.label')}>
			<div class="chips" role="group" aria-label={t('search.filters.kind')}>
				{#each KINDS as kind (kind)}
					<button
						type="button"
						class="chip"
						aria-pressed={filters.kind === kind}
						onclick={() => applyFilters(setKind(filters, kind))}
					>
						{kind === 'character' ? t('search.filters.characters') : t('search.filters.words')}
					</button>
				{/each}
			</div>
			{#if schemes.length > 0}
				<div class="chips" role="group" aria-label={t('search.filters.scheme')}>
					{#each schemes as scheme (scheme.id)}
						<button
							type="button"
							class="chip"
							aria-pressed={filters.scheme === scheme.packId}
							onclick={() => applyFilters(setScheme(filters, scheme.packId ?? ''))}
						>
							{scheme.name}
						</button>
					{/each}
				</div>
			{:else if schemesFailed}
				<p class="note">{t('search.filters.levelsUnavailable')}</p>
			{:else if !schemesLoaded}
				<div class="chips placeholder" aria-hidden="true"></div>
			{/if}
			{#if activeScheme}
				<div class="chips" role="group" aria-label={t('search.filters.level')}>
					{#each activeScheme.levels as level (level.id)}
						<button
							type="button"
							class="chip"
							aria-pressed={filters.level === level.name}
							onclick={() => applyFilters(setLevel(filters, level.name))}
						>
							{level.name}
						</button>
					{/each}
				</div>
			{/if}
			<button
				type="button"
				class="clear"
				disabled={!hasFilters(filters)}
				onclick={() => applyFilters(clearFilters())}
			>
				{t('search.filters.clear')}
			</button>
		</div>
	{/if}

	<!-- Always mounted so assistive tech announces changes to its text. -->
	<p class="visually-hidden" role="status" aria-live="polite">{announcement}</p>

	{#if noDictionary && lang !== null}
		<p class="hint" role="status">{dictionaryHint(languageLabel(lang), $user?.admin === true)}</p>
	{/if}

	{#if lang === null && $workspacesLoaded}
		<p class="hint">
			{t('search.noWorkspace')}
			<a href="/settings">{t('search.openSettings')}</a>
		</p>
	{:else if loading}
		<p class="hint" aria-live="polite">{t('search.searching')}</p>
	{:else if error}
		<p class="error" role="alert">{error}</p>
		<button type="button" class="retry" onclick={retry}>{t('common.action.retry')}</button>
	{:else if searched && hits.length === 0}
		<p class="hint">
			{hasFilters(filters)
				? t('search.noResultsFiltered', { query: activeQuery })
				: t('search.noResults', { query: activeQuery })}
		</p>
	{:else if hits.length > 0}
		<p class="scount">{t('search.count', { count: hits.length, query: activeQuery })}</p>
		{#if hits.length >= RESULT_CAP}
			<p class="note">{t('search.capped', { count: RESULT_CAP })}</p>
		{/if}
		<ul class="results" aria-label={t('search.results')}>
			{#each hits as hit (hit.id)}
				<li>
					<ResultRow
						{hit}
						href={searchHref(activeQuery, filters, hit.id)}
						selected={selected === hit.id}
						hidden={hidden}
						onactivate={(event) => choose(event, hit.id)}
					/>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="hint">
			{hasFilters(filters) ? t('search.enterQueryFiltered') : t('search.enterQuery')}
		</p>
	{/if}
		</div>

		<div class="detail-pane">
			{#if preview}
				<div class="back-to-results"><Button variant="secondary" href={searchHref(activeQuery, filters)}>{t('search.backToResults')}</Button></div>
				<EntryView entryId={preview.id} headingLevel={2} recordView={selected !== null} />
			{:else}
				<p class="hint">{t('search.detail')}</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
		align-items: start;
	}
	.list-pane,
	.detail-pane {
		min-width: 0;
		display: grid;
		gap: var(--space-3);
		align-content: start;
	}
	.search {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-2);
	}
	.search :global(.field) {
		flex: 1 1 12rem;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-4);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
	}
	.chip,
	.clear {
		font: inherit;
		font-size: var(--font-size-label);
		padding: var(--space-1) 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--readable-muted);
		cursor: pointer;
		box-shadow: inset 0 -1.5px 0 transparent;
	}
	.chip[aria-pressed='true'] {
		color: var(--text);
		box-shadow: inset 0 -1.5px 0 var(--accent);
	}
	.clear:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.chip:focus-visible,
	.clear:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.note,
	.scount {
		margin: 0;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	.results {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 1px;
	}
	.hint {
		color: var(--readable-muted);
	}
	.error {
		color: var(--readable-bad);
	}
	.back-to-results {
		justify-self: start;
	}
	@media (max-width: 45rem) {
		.split.has-selection .list-pane,
		.split:not(.has-selection) .detail-pane {
			display: none;
		}
	}
	@media (min-width: 45rem) {
		.split {
			grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr);
		}
		.back-to-results {
			display: none;
		}
	}
</style>
