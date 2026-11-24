<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { search } from '$lib/api/search';
	import type { SearchHit } from '$lib/api/types';
	import { recordLookup } from '$lib/lookups/sink';
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
		submitHref,
		type SearchFilters
	} from '$lib/searchFilters';
	import { onMount, tick } from 'svelte';
	import { listLanguages } from '$lib/api/languages';
	import { dictionaryHint } from '$lib/coverage';
	import { hiddenDictionaries } from '$lib/dictionaryVisibility';
	import { languageLabel, usesHan } from '$lib/languages';
	import { FRAME_PHONE_BREAKPOINT, PHONE_MEDIA_QUERY } from '$lib/frame/breakpoint';
	import Field from '$lib/ui/Field.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';
	import ResultRow from './ResultRow.svelte';
	import EntryView from '$lib/entry/EntryView.svelte';
	import { useApp } from '$lib/context/context';
	import { useSession } from '$lib/context/context';
	const session = useSession();
	const app = useApp();

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

	const lang = $derived(session.workspaces.language);
	const hidden = $derived(hiddenDictionaries(session.workspaces.current));
	const urlQuery = $derived(page.url.searchParams.get('q') ?? '');
	const selected = $derived(selectedFromParams(page.url.searchParams));
	// The URL's e is the detail's entry even when the visible hits do not
	// contain it (a shared link, a filter that hides it, the result cap):
	// a preview only fills in when nothing is selected.
	const detailId = $derived(selected ?? hits[0]?.id ?? null);
	// The written form the URL's entry loaded with, so the document title
	// names that entry and never a preview or a stale load.
	let titledEntry = $state<{ id: number; written: string } | null>(null);
	const titleWord = $derived(
		selected !== null && titledEntry?.id === selected ? titledEntry.written : ''
	);

	function titled(written: string): void {
		if (selected === null || detailId !== selected) return;
		titledEntry = { id: detailId, written };
	}

	// Guards against a slow earlier request overwriting a newer result.
	let requestSeq = 0;

	// The result row that is the list's single tab stop; ArrowUp/Down move
	// between rows, Home/End jump, and Back to results returns here.
	let activeId = $state<number | null>(null);
	// Set by a phone selection so the entry heading takes focus once it loads.
	let focusDetail = $state(false);
	let lastSelected: number | null = null;

	$effect(() => {
		const ids = hits.map((h) => h.id);
		if (activeId === null || !ids.includes(activeId)) activeId = ids[0] ?? null;
	});

	// Leaving a selection (Back to results) remembers its row; the list is
	// re-rendered by a fresh search, so focus waits until it is back.
	let returnFocusId = $state<number | null>(null);
	$effect(() => {
		const id = selected;
		if (id !== null) {
			lastSelected = id;
			returnFocusId = null;
			return;
		}
		if (lastSelected === null) return;
		returnFocusId = lastSelected;
		lastSelected = null;
		focusDetail = false;
	});
	$effect(() => {
		const id = returnFocusId;
		const busy = loading;
		const present = hits.some((h) => h.id === id);
		if (id === null || busy || selected !== null || !present) return;
		// The URL change also starts a fresh search; wait one flush for it so
		// focus lands on the row once the list is rendered again.
		void tick().then(() => {
			if (returnFocusId !== id || loading || selected !== null) return;
			const row = document.getElementById(`hit-row-${id}`);
			if (row === null) return;
			returnFocusId = null;
			activeId = id;
			row.focus();
		});
	});

	function rowKeys(event: KeyboardEvent): void {
		const key = event.key;
		if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;
		const target = event.target instanceof Element ? event.target.closest('a[data-row-id]') : null;
		const current = Number(target?.getAttribute('data-row-id') ?? activeId);
		const index = hits.findIndex((h) => h.id === current);
		if (index < 0) return;
		event.preventDefault();
		const next =
			key === 'Home'
				? 0
				: key === 'End'
					? hits.length - 1
					: key === 'ArrowDown'
						? Math.min(index + 1, hits.length - 1)
						: Math.max(index - 1, 0);
		const id = hits[next]?.id;
		if (id === undefined) return;
		activeId = id;
		document.getElementById(`hit-row-${id}`)?.focus();
	}

	let allSchemes = $state<Scheme[]>([]);
	let schemesFailed = $state(false);
	const filters = $derived(filtersFromParams(page.url.searchParams));
	const schemes = $derived(schemesForLanguage(allSchemes, lang));
	let schemesLoaded = $state(false);
	// The form, so the icon-only submit button can submit it (IconButton is
	// always type=button; Enter in the field submits natively too).
	let searchForm = $state<HTMLFormElement | null>(null);
	// The frame's one layout switch: the detail preview exists only beside
	// the list, never as a hidden fetch on the phone.
	let wide = $state(true);
	const levelText = $derived(
		t('search.filters.levelMenu', {
			level: filters.level || t('search.filters.anyLevel')
		})
	);

	// Languages with installed dictionary data; null until loaded.
	let installedCodes = $state<Set<string> | null>(null);
	const noDictionary = $derived(
		lang !== null && installedCodes !== null && !installedCodes.has(lang.toLowerCase())
	);

	onMount(() => {
		let media: MediaQueryList | null = null;
		const change = (e: MediaQueryListEvent): void => {
			wide = e.matches;
		};
		if (typeof window.matchMedia === 'function') {
			media = window.matchMedia(`(min-width: ${FRAME_PHONE_BREAKPOINT}px)`);
			wide = media.matches;
			media.addEventListener('change', change);
		}
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
		return () => media?.removeEventListener('change', change);
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


	// Opening a result is the look-up (#72): it goes to the lookup history
	// of the current workspace (a click, Enter, Ctrl/Cmd-click or a middle
	// click; "open in new tab" from the context menu is not seen). Typed
	// queries are never recorded.
	function openedHit(entryId: number): void {
		recordLookup(session.lookups.recorder, session.workspaces.current?.id, { entryId, source: 'search' });
	}

	/** Choosing a result: desktop replaces the entry in place; a phone pushes, so Back returns to the list. */
	function choose(event: MouseEvent, entryId: number): void {
		// A middle click / modified click opens the real href in another tab:
		// record the lookup, but never cancel the browser's own action or
		// navigate this one.
		if (event.type === 'auxclick' || event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey) {
			openedHit(entryId);
			return;
		}
		event.preventDefault();
		openedHit(entryId);
		// The clicked row is the list's tab stop when the reader comes back.
		activeId = entryId;
		const wide =
			typeof window.matchMedia !== 'function' || !window.matchMedia(PHONE_MEDIA_QUERY).matches;
		// A phone push scrolls to the top and moves focus to the entry once
		// it loads; a wide selection keeps the reader's place on the row.
		focusDetail = !wide;
		void goto(searchHref(activeQuery, filters, entryId), {
			replaceState: wide,
			keepFocus: wide,
			noScroll: wide
		});
	}

	// What a screen reader hears once a search settles; empty while it runs
	// or when there is nothing to say (the visible hint covers those).
	const announcement = $derived.by(() => {
		if (loading || error || !searched) return '';
		if (hits.length === 0) return t('search.noResults', { query: activeQuery });
		return t('search.resultsAnnounce', { count: hits.length, query: activeQuery });
	});

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
			error = errorText(err, t('search.failed'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		const q = query.trim();
		// Show the query that is searched, not the untrimmed text typed.
		query = q;
		const href = submitHref(q, filters);
		// The same search again does not change the URL, so the effect below
		// would not run: treat it as a refresh instead of a silent no-op.
		// The comparison includes everything in the URL (the selected entry
		// too), so resubmitting a query with e drops e.
		if (q && lang && href === page.url.pathname + page.url.search) {
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
	<title>{pageTitle(titleWord, t('search.title'))}</title>
</svelte:head>

<div class="page-body search-page">
	<h1>{t('search.title')}</h1>

	<div class="split" class:has-selection={selected !== null}>
		<div class="list-pane">

	<form class="search" role="search" onsubmit={submit} bind:this={searchForm}>
		<div class="sfield">
			<span class="sfield-icon" aria-hidden="true"><Icon name="search" size="s" /></span>
			<Field
				label={t('search.input.label')}
				hideLabel
				name="q"
				type="search"
				bind:value={query}
				placeholder={lang !== null
					? t('search.input.placeholder')
					: session.workspaces.loaded
						? t('search.input.selectWorkspace')
						: t('search.input.loadingWorkspaces')}
				disabled={lang === null}
			/>
			<IconButton
				label={t('search.submit')}
				icon="search"
				disabled={lang === null}
				onclick={() => searchForm?.requestSubmit()}
			/>
			{#if lang !== null && usesHan(lang)}
				<IconButton label={t('search.byParts')} icon="parts" href="/search/parts" />
			{/if}
		</div>
	</form>

	<p class="parts-link"><a href="/lookups">{t('search.lookupsLink')}</a></p>

	{#if lang !== null}
		<div class="filters" role="group" aria-label={t('search.filters.label')}>
			<div class="chips" role="group" aria-label={t('search.filters.kind')}>
				<button
					type="button"
					class="chip"
					aria-pressed={filters.kind === ''}
					onclick={() => applyFilters({ ...filters, kind: '' })}
				>
					{t('search.filters.all')}
				</button>
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
				<Menu label={t('search.filters.level')} text={levelText} menuLabel={t('search.filters.level')} align="start">
					<MenuItem
						checked={filters.scheme === '' && filters.level === ''}
						onselect={() => applyFilters({ ...filters, scheme: '', level: '' })}
					>
						{t('search.filters.anyLevelItem')}
					</MenuItem>
					{#each schemes as scheme (scheme.id)}
						{#each scheme.levels as level (`${scheme.id}:${level.id}`)}
							<MenuItem
								checked={filters.scheme === scheme.packId && filters.level === level.name}
								onselect={() => applyFilters(setLevel(setScheme(filters, scheme.packId ?? ''), level.name))}
							>
								{t('search.filters.schemeLevel', { scheme: scheme.name, level: level.name })}
							</MenuItem>
						{/each}
					{/each}
				</Menu>
			{:else if schemesFailed}
				<p class="note">{t('search.filters.levelsUnavailable')}</p>
			{:else if !schemesLoaded}
				<div class="chips placeholder" aria-hidden="true"></div>
			{/if}
			{#if hasFilters(filters)}
				<button type="button" class="clear" onclick={() => applyFilters(clearFilters())}>
					{t('search.filters.clear')}
				</button>
			{/if}
		</div>
	{/if}

	<!-- Always mounted so assistive tech announces changes to its text. -->
	<p class="visually-hidden" role="status" aria-live="polite">{announcement}</p>

	{#if noDictionary && lang !== null}
		<p class="hint" role="status">{dictionaryHint(languageLabel(lang), app.auth.user?.admin === true)}</p>
	{/if}

	{#if lang === null && session.workspaces.loaded}
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
						tabstop={hit.id === activeId}
						hidden={hidden}
						onactivate={(event) => choose(event, hit.id)}
						onkey={rowKeys}
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
			{#if selected !== null}
				<div class="back-to-results"><Button variant="secondary" href={searchHref(activeQuery, filters)}>{t('search.backToResults')}</Button></div>
			{/if}
			{#if detailId !== null && (wide || selected !== null)}
				<EntryView
					entryId={detailId}
					headingLevel={2}
					recordView={selected !== null && detailId === selected}
					focusOnLoad={focusDetail && selected !== null && detailId === selected}
					backHref={searchHref(activeQuery, filters)}
					ontitle={titled}
				/>
			{:else}
				<p class="hint">{t('search.detail')}</p>
			{/if}
		</div>
	</div>
</div>

<style>
	/* Text links stay recognisable without colour (#106): theme-aware accent
	   text and an underline. */
	.parts-link a {
		color: var(--reading-accent);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

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
	.sfield {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.sfield :global(.field) {
		flex: 1 1 auto;
		min-width: 0;
	}
	.sfield-icon {
		display: inline-grid;
		place-items: center;
		color: var(--readable-muted);
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
	@media (max-width: 719.98px) {
		.split.has-selection .list-pane,
		.split:not(.has-selection) .detail-pane {
			display: none;
		}
	}
	@media (min-width: 720px) {
		.split {
			grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr);
		}
		.back-to-results {
			display: none;
		}
	}
</style>
