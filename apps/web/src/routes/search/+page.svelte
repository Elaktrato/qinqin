<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { search } from '$lib/api/search';
	import type { SearchHit } from '$lib/api/types';
	import { record } from '$lib/events';
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
		setKind,
		setLevel,
		setScheme,
		type SearchFilters
	} from '$lib/searchFilters';
	import { onMount } from 'svelte';
	import { listLanguages } from '$lib/api/languages';
	import { dictionaryHint } from '$lib/coverage';
	import { languageLabel } from '$lib/languages';
	import { user } from '$lib/auth';

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
	const urlQuery = $derived(page.url.searchParams.get('q') ?? '');

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
		goto(searchHref(urlQuery.trim(), next), { keepFocus: true, noScroll: true }).catch(() => {});
	}

	// After a workspace/language switch, a scheme or level of another
	// language must not stay in the URL as a hidden filter.
	$effect(() => {
		if (!schemesLoaded || lang === null) return;
		const next = reconcileFilters(filters, schemes);
		if (next !== filters) {
			goto(searchHref(urlQuery.trim(), next), {
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

	// One lookup per query and language for this page visit: the URL
	// effect re-runs on navigation and workspace switches, but a repeat
	// search must not inflate the study log.
	const recordedLookups = new Set<string>();

	function recordLookup(q: string, language: string): void {
		const key = `${language}\u0000${q}`;
		if (recordedLookups.has(key)) return;
		const workspace = get(workspaces).current;
		if (!workspace) return;
		recordedLookups.add(key);
		void record('lookup', workspace.id, { query: q });
	}

	// What a screen reader hears once a search settles; empty while it runs
	// or when there is nothing to say (the visible hint covers those).
	const announcement = $derived.by(() => {
		if (loading || error || !searched) return '';
		if (hits.length === 0) return `No results for “${activeQuery}”.`;
		return `${hits.length} ${hits.length === 1 ? 'result' : 'results'} for “${activeQuery}”.`;
	});

	function sourceLabel(source: string): string {
		return source === 'written' ? 'written form' : source;
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
			error = message(err, 'Search failed.');
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
		recordLookup(q, language);
	});
</script>

<svelte:head>
	<title>{pageTitle('Search')}</title>
</svelte:head>

<main class="search-page">
	<h1>Search</h1>

	<form class="search" role="search" onsubmit={submit}>
		<input
			name="q"
			type="search"
			bind:value={query}
			aria-label="Search entries"
			placeholder={lang !== null
				? 'Search entries…'
				: $workspacesLoaded
					? 'Select a workspace to search'
					: 'Loading workspaces…'}
			disabled={lang === null}
		/>
		<button type="submit" disabled={lang === null}>Search</button>
	</form>

	{#if lang !== null}
		<div class="filters" role="group" aria-label="Search filters">
			<div class="chips" role="group" aria-label="Kind">
				{#each KINDS as kind (kind)}
					<button
						type="button"
						class="chip"
						aria-pressed={filters.kind === kind}
						onclick={() => applyFilters(setKind(filters, kind))}
					>
						{kind === 'character' ? 'Characters' : 'Words'}
					</button>
				{/each}
			</div>
			{#if schemes.length > 0}
				<div class="chips" role="group" aria-label="Scheme">
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
				<p class="note">Level filters are unavailable right now.</p>
			{:else if !schemesLoaded}
				<div class="chips placeholder" aria-hidden="true"></div>
			{/if}
			{#if activeScheme}
				<div class="chips" role="group" aria-label="Level">
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
				Clear filters
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
			No workspace selected. Create or select a workspace in the header to search.
			<a href="/settings">Open settings</a>
		</p>
	{:else if loading}
		<p class="hint" aria-live="polite">Searching…</p>
	{:else if error}
		<p class="error" role="alert">{error}</p>
		<button type="button" class="retry" onclick={retry}>Try again</button>
	{:else if searched && hits.length === 0}
		<p class="hint">
			No results for “{activeQuery}”{hasFilters(filters) ? ' with these filters' : ''}.
		</p>
	{:else if hits.length > 0}
		{#if hits.length >= RESULT_CAP}
			<p class="note">
				Showing the first {RESULT_CAP} results. Add more of the word or a filter to narrow them.
			</p>
		{/if}
		<ul class="results" aria-label="Search results">
			{#each hits as hit (hit.id)}
				<li class="result">
					<a class="written" href={`/entry/${hit.id}`}>{hit.written}</a>

					<div class="details">
						{#if hit.readings.length > 0}
							<span class="readings">
								{#each hit.readings as reading (reading.ord)}
									<span class="reading" data-type={reading.type}>{reading.value}</span>
								{/each}
							</span>
						{/if}
						<span class="source">matched {sourceLabel(hit.source)}</span>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="hint">Enter a query to search entries{hasFilters(filters) ? ' within the filters' : ''}.</p>
	{/if}
</main>

<style>
	.filters {
		display: grid;
		gap: 0.6rem;
		margin-top: 1rem;
		max-width: 40rem;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip,
	.clear {
		font: inherit;
		font-size: 0.9rem;
		min-height: 2.75rem;
		padding: 0.3rem 0.85rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.placeholder {
		min-height: 2.75rem;
	}

	.clear:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.chip[aria-pressed='true'] {
		background: #0b6bcb;
		border-color: #0b6bcb;
		color: #fff;
	}

	.chip:focus-visible,
	.clear:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.clear {
		justify-self: start;
		border-style: dashed;
	}

	.note {
		margin: 0;
		font-size: 0.85rem;
		opacity: 0.75;
	}

	.search {
		display: flex;
		gap: 0.5rem;
		max-width: 32rem;
	}

	.search input {
		flex: 1;
		min-width: 0;
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.search button {
		font: inherit;
		font-weight: 600;
		padding: 0.6rem 1rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		cursor: pointer;
	}

	.hint {
		margin-top: 1.5rem;
		opacity: 0.75;
	}

	.error {
		margin-top: 1.5rem;
		color: #c62828;
		font-weight: 600;
	}

	.retry {
		margin-top: 0.75rem;
		font: inherit;
		padding: 0.45rem 0.85rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.results {
		list-style: none;
		margin: 1.5rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.result {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.75rem 1rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
	}

	.written {
		font-size: 1.6rem;
		line-height: 1.2;
		font-weight: 600;
		text-decoration: none;
	}

	.written:hover,
	.written:focus-visible {
		text-decoration: underline;
	}

	.details {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem 0.85rem;
	}

	.readings {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.reading {
		font-size: 1rem;
	}

	.source {
		font-size: 0.8rem;
		opacity: 0.7;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}
</style>
